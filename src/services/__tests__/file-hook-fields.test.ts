// File hooks: result bodies and extracted fields (R2.2, R2.6, R3.2, R3.3, R3.5). Every limit is
// checked at N and N+1.
import { describe, expect, it } from "vitest";
import {
  bandFor,
  checkExtractedFields,
  extractionResultSchema,
  HIGH_CONFIDENCE_PERCENT,
  MAX_EXTRACTED_FIELDS,
  MAX_EXTRACTED_VALUE_CHARS,
  MAX_FIELD_NAME_CHARS,
  MAX_LABEL_CHARS,
  MEDIUM_CONFIDENCE_PERCENT,
  scanResultSchema,
  type ExtractedField,
  type FieldSpec,
} from "@/services/file-hook-fields";

const scan = (over: Record<string, unknown> = {}) =>
  scanResultSchema.safeParse({
    result: "clean",
    contentHash: "sha256:ab",
    attempt: 1,
    engine: "ClamAV 1.3",
    ...over,
  }).success;

describe("scan result body", () => {
  it("accepts a plain result", () => expect(scan()).toBe(true));
  it.each([
    ["engine at the limit", { engine: "a".repeat(MAX_LABEL_CHARS) }, true],
    ["engine past the limit", { engine: "a".repeat(MAX_LABEL_CHARS + 1) }, false],
    ["engine with a tag", { engine: "<b>AV</b>" }, false],
    ["engine with a newline", { engine: "AV\nx" }, false],
    ["empty engine", { engine: "" }, false],
    ["threat name with an infected result", { result: "infected", threatName: "Eicar-Test" }, true],
    ["threat name with a clean result", { threatName: "Eicar-Test" }, false],
    ["threat name with a quote", { result: "infected", threatName: 'Eicar"x' }, false],
    ["unknown result", { result: "maybe" }, false],
    ["attempt 0", { attempt: 0 }, false],
    ["attempt as text", { attempt: "1" }, false],
    ["fractional attempt", { attempt: 1.5 }, false],
    ["unknown key", { verdict: "ok" }, false],
    ["hash with odd characters", { contentHash: "ab cd" }, false],
  ])("%s", (_n, over, want) => expect(scan(over)).toBe(want));
});

describe("extraction result body", () => {
  const f = (over: Partial<ExtractedField> = {}) => ({
    name: "amount",
    value: 10,
    confidence: 0.9,
    ...over,
  });
  const parse = (b: unknown) => extractionResultSchema.safeParse(b).success;
  it.each([
    ["read with fields", { result: "read", attempt: 2, fields: [f()] }, true],
    ["read with no fields", { result: "read", attempt: 2, fields: [] }, true],
    ["unreadable", { result: "unreadable", attempt: 2 }, true],
    ["unreadable with fields", { result: "unreadable", attempt: 2, fields: [f()] }, false],
    [
      "fields at the limit",
      { result: "read", attempt: 2, fields: Array(MAX_EXTRACTED_FIELDS).fill(f()) },
      true,
    ],
    [
      "fields past the limit",
      { result: "read", attempt: 2, fields: Array(MAX_EXTRACTED_FIELDS + 1).fill(f()) },
      false,
    ],
    ["confidence 0", { result: "read", attempt: 2, fields: [f({ confidence: 0 })] }, true],
    ["confidence 1", { result: "read", attempt: 2, fields: [f({ confidence: 1 })] }, true],
    [
      "confidence above 1",
      { result: "read", attempt: 2, fields: [f({ confidence: 1.01 })] },
      false,
    ],
    [
      "confidence below 0",
      { result: "read", attempt: 2, fields: [f({ confidence: -0.01 })] },
      false,
    ],
    [
      "confidence as text",
      { result: "read", attempt: 2, fields: [{ ...f(), confidence: "0.9" }] },
      false,
    ],
    [
      "source label",
      { result: "read", attempt: 2, fields: [f({ source: "page 2: table 1" })] },
      true,
    ],
    [
      "source link",
      { result: "read", attempt: 2, fields: [f({ source: "https://x.test/?a=1" })] },
      false,
    ],
    [
      "source past the limit",
      { result: "read", attempt: 2, fields: [f({ source: "a".repeat(MAX_LABEL_CHARS + 1) })] },
      false,
    ],
    ["unknown field key", { result: "read", attempt: 2, fields: [{ ...f(), note: "x" }] }, false],
  ])("%s", (_n, b, want) => expect(parse(b)).toBe(want));
});

const SPEC: FieldSpec[] = [
  { name: "party", valueType: "string" },
  { name: "amount", valueType: "number" },
  { name: "signedOn", valueType: "date" },
  { name: "kind", valueType: "enum", enumValues: ["msa", "sow"] },
  { name: "renewal", valueType: "boolean" },
  { name: "strict", valueType: "string", reviewThreshold: 0.97 },
  { name: "untyped" },
  { name: "odd", valueType: "geometry" },
];
const field = (name: string, value: unknown, confidence = 0.95): ExtractedField => ({
  name,
  value,
  confidence,
});

describe("extracted fields are checked as a whole", () => {
  it("accepts every type it knows and gives each a band", () => {
    const r = checkExtractedFields(
      [
        field("party", "Aurora AB"),
        field("amount", 1200.5, 0.75),
        field("signedOn", "2024-02-29", 0.2),
        field("kind", "msa"),
        field("renewal", false),
        field("untyped", "x"),
      ],
      SPEC,
    );
    expect(r.ok && r.fields.map((x) => [x.name, x.value, x.band])).toEqual([
      ["party", "Aurora AB", "high"],
      ["amount", 1200.5, "medium"],
      ["signedOn", "2024-02-29", "low"],
      ["kind", "msa", "high"],
      ["renewal", false, "high"],
      ["untyped", "x", "high"],
    ]);
  });
  it("refuses unknown names (exact match) and lists them", () => {
    expect(checkExtractedFields([field("Party", "x"), field("amount", 1)], SPEC)).toEqual({
      ok: false,
      code: "unknownFields",
      names: ["Party"],
    });
  });
  it("shortens a long unknown name", () => {
    const r = checkExtractedFields([field("n".repeat(200), "x")], SPEC);
    expect(!r.ok && [...r.names[0]!].length).toBe(64);
  });
  it("refuses duplicates", () => {
    expect(checkExtractedFields([field("amount", 1), field("amount", 2)], SPEC)).toMatchObject({
      ok: false,
      code: "duplicateFields",
      names: ["amount"],
    });
  });
  it.each([
    ["number as text", "amount", "1200"],
    ["infinite number", "amount", Number.POSITIVE_INFINITY],
    ["impossible date", "signedOn", "2023-02-29"],
    ["date with a time", "signedOn", "2024-02-01T00:00:00Z"],
    ["enum outside the list", "kind", "nda"],
    ["boolean as text", "renewal", "false"],
    ["text as an object", "party", { toString: "x" }],
    ["control character", "party", "Aurora\u0007AB"],
    ["newline", "party", "Aurora\nAB"],
    ["bidi override", "party", "Aurora \u202Egnp.exe"],
    ["direction isolate", "party", "\u2066Aurora\u2069"],
    ["right-to-left mark", "party", "Aurora\u200F"],
    ["a type the rule does not know", "odd", "x"],
  ])("refuses %s and nothing is accepted", (_n, name, value) => {
    const valid = name === "amount" ? field("party", "Aurora AB") : field("amount", 1);
    expect(checkExtractedFields([valid, field(name, value)], SPEC)).toEqual({
      ok: false,
      code: "badValues",
      names: [name],
    });
  });
  it("counts text length in code points: N passes, N+1 does not", () => {
    const emoji = "😀"; // two UTF-16 units, one code point
    const atLimit = emoji.repeat(MAX_EXTRACTED_VALUE_CHARS);
    expect(checkExtractedFields([field("party", atLimit)], SPEC).ok).toBe(true);
    expect(checkExtractedFields([field("party", atLimit + "a")], SPEC).ok).toBe(false);
  });
});

describe("confidence bands", () => {
  const H = HIGH_CONFIDENCE_PERCENT / 100;
  const M = MEDIUM_CONFIDENCE_PERCENT / 100;
  it.each([
    [H, undefined, "high"],
    [H - 0.001, undefined, "medium"],
    [M, undefined, "medium"],
    [M - 0.001, undefined, "low"],
    [0, undefined, "low"],
    [0.96, 0.97, "medium"],
    [0.97, 0.97, "high"],
    // A field threshold can only make High stricter, never looser.
    [H - 0.01, 0.5, "medium"],
    [H, 2, "high"],
  ] as const)("%s with field threshold %s → %s", (c, t, want) => {
    expect(bandFor(c, t)).toBe(want);
  });
});
describe("details of the result body", () => {
  it("a field sent without a value is refused by name", () => {
    expect(
      checkExtractedFields([{ name: "amount", confidence: 0.9 } as ExtractedField], SPEC),
    ).toEqual({ ok: false, code: "badValues", names: ["amount"] });
  });
  it("an unknown name is listed with unsafe characters replaced", () => {
    const r = checkExtractedFields([field("x\u202Eevil", "v")], SPEC);
    expect(r).toEqual({ ok: false, code: "unknownFields", names: ["x\uFFFDevil"] });
  });
  it("counts a field name in code points", () => {
    const body = (name: string) =>
      extractionResultSchema.safeParse({
        result: "read",
        attempt: 1,
        fields: [{ name, value: "x", confidence: 1 }],
      }).success;
    expect(body("😀".repeat(MAX_FIELD_NAME_CHARS))).toBe(true);
    expect(body("😀".repeat(MAX_FIELD_NAME_CHARS + 1))).toBe(false);
  });
});
