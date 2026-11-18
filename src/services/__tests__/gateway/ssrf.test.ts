// Characterisation of the address checks that protect webhook callbacks and URL attachments:
// first the URL on its own, then the addresses its name points to. The classification of single
// addresses is tested in ip-rules.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSafeCallback } from "@/services/tmf667-mapper";
import { resolvesPublic } from "@/test/gateway-api";

type Dns = Partial<Record<"A" | "AAAA", string[]>>;
let queried: string[] = [];

/** Answers the DNS-over-HTTPS lookups the gateway makes (record type 1 = A, 28 = AAAA). */
function dns(answers: Dns | "fail") {
  queried = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      queried.push(url);
      if (answers === "fail") throw new Error("network down");
      const type = new URL(url).searchParams.get("type") as "A" | "AAAA";
      const data = answers[type] ?? [];
      return new Response(
        JSON.stringify({ Answer: data.map((d) => ({ type: type === "A" ? 1 : 28, data: d })) }),
      );
    }),
  );
}

beforeEach(() => dns({}));
afterEach(() => vi.unstubAllGlobals());

describe("isSafeCallback looks at the URL only", () => {
  it.each([
    ["https://hooks.example.com/in", true],
    ["https://hooks.example.com:8443/in?x=1", true],
    ["http://hooks.example.com/in", false],
    ["ftp://hooks.example.com/in", false],
    ["not a url", false],
    ["", false],
    ["https://localhost/in", false],
    ["https://printer.local/in", false],
    ["https://127.0.0.1/in", false],
    ["https://10.1.2.3/in", false],
    ["https://192.168.1.1/in", false],
    ["https://169.254.169.254/latest", false],
    ["https://172.16.0.1/in", false],
    ["https://172.31.255.255/in", false],
    ["https://[::1]/in", false],
    ["https://[fd00::1]/in", false],
  ])("%s -> %s", (url, safe) => {
    expect(isSafeCallback(url)).toBe(safe);
  });

  it.each([
    ["a name with a trailing dot", "https://localhost./in"],
    ["a subdomain of localhost", "https://app.localhost/in"],
    ["an internal-only name", "https://db.internal/in"],
    ["carrier-grade NAT", "https://100.64.0.9/in"],
    ["the 'this network' range", "https://0.0.0.0/in"],
    ["a decimal loopback (the URL parser turns it into 127.0.0.1)", "https://2130706433/in"],
    ["a hex loopback", "https://0x7f000001/in"],
    ["a shortened loopback", "https://127.1/in"],
    ["multicast", "https://224.0.0.1/in"],
    ["benchmarking", "https://198.18.0.1/in"],
    ["credentials in the address", "https://user:secret@hooks.example.com/in"],
  ])("refuses %s", (_label, url) => {
    expect(isSafeCallback(url)).toBe(false);
  });
  it("is not fooled by capitals or a trailing dot on a public name", () => {
    expect(isSafeCallback("https://Hooks.Example.COM./in")).toBe(true);
    expect(isSafeCallback("https://LOCALHOST/in")).toBe(false);
  });
  it("lets 172.32.x through: that range is public", () => {
    expect(isSafeCallback("https://172.32.0.1/in")).toBe(true);
  });
});

describe("resolvesPublic: the URL, then the address the name points to", () => {
  it("refuses a URL that is unsafe by itself without asking DNS", async () => {
    expect(await resolvesPublic("http://hooks.example.com/in")).toBe(false);
    expect(await resolvesPublic("https://localhost/in")).toBe(false);
    expect(queried).toHaveLength(0);
  });

  it("accepts a public IP address without asking DNS, and refuses a private one", async () => {
    expect(await resolvesPublic("https://93.184.216.34/in")).toBe(true);
    expect(await resolvesPublic("https://100.64.0.9/in")).toBe(false);
    expect(queried).toHaveLength(0);
  });

  it("asks for both A and AAAA records of the host, through a public DNS-over-HTTPS service", async () => {
    dns({ A: ["93.184.216.34"] });
    expect(await resolvesPublic("https://hooks.example.com/in")).toBe(true);
    expect(queried).toHaveLength(2);
    expect(
      queried.every((u) =>
        u.startsWith("https://cloudflare-dns.com/dns-query?name=hooks.example.com"),
      ),
    ).toBe(true);
    expect(queried.map((u) => new URL(u).searchParams.get("type"))).toEqual(["A", "AAAA"]);
  });

  it.each([
    ["a public IPv4", { A: ["93.184.216.34"] }, true],
    ["a public IPv6", { AAAA: ["2606:4700::1111"] }, true],
    ["a public IPv4 and a public IPv6", { A: ["93.184.216.34"], AAAA: ["2606:4700::1111"] }, true],
    ["a private IPv4", { A: ["10.0.0.5"] }, false],
    ["loopback", { A: ["127.0.0.1"] }, false],
    ["the cloud metadata address", { A: ["169.254.169.254"] }, false],
    ["a private IPv6", { AAAA: ["fd00::5"] }, false],
    ["an IPv4-mapped IPv6", { AAAA: ["::ffff:7f00:1"] }, false],
    [
      "one public and one private address (any private one blocks it)",
      { A: ["93.184.216.34", "10.0.0.5"] },
      false,
    ],
    ["a public IPv4 and a private IPv6", { A: ["93.184.216.34"], AAAA: ["::1"] }, false],
    ["no addresses at all", {}, false],
  ] as [string, Dns, boolean][])("a name that points to %s -> %s", async (_name, answers, ok) => {
    dns(answers);
    expect(await resolvesPublic("https://hooks.example.com/in")).toBe(ok);
  });

  it("refuses when the lookup itself fails", async () => {
    dns("fail");
    expect(await resolvesPublic("https://hooks.example.com/in")).toBe(false);
  });

  it("refuses a name that points to the NAT64 form of a private host", async () => {
    dns({ AAAA: ["64:ff9b::a00:1"] });
    expect(await resolvesPublic("https://hooks.example.com/in")).toBe(false);
  });
});
