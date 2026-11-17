import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FakeDb } from "@/test/fake-db";
import { removeTokensOf } from "@/services/gateway-token";
import { DatabaseError } from "@/services/shared/must";

describe("removeTokensOf", () => {
  it("removes every token of that system and no other", async () => {
    const db = new FakeDb({
      integration_tokens: [
        { client_id: "a", token_hash: "1" },
        { client_id: "a", token_hash: "2" },
        { client_id: "b", token_hash: "3" },
      ],
    });
    await removeTokensOf(db.asDb(), "a");
    expect(db.rows("integration_tokens")).toEqual([{ client_id: "b", token_hash: "3" }]);
  });
  it("throws when the database refuses, so the key is not reported as rotated with live tokens", async () => {
    const db = new FakeDb({ integration_tokens: [] }).fail("integration_tokens", "delete");
    await expect(removeTokensOf(db.asDb(), "a")).rejects.toBeInstanceOf(DatabaseError);
  });
});

describe("rotating or revoking a system's key", () => {
  // The two handlers are server functions that tests cannot call, so this guards the wiring.
  const source = readFileSync("src/services/integration-clients.functions.ts", "utf8");
  const handler = (name: string) => {
    const start = source.indexOf(`export const ${name} =`);
    const next = source.indexOf("\nexport const ", start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  };
  it.each(["rotateSystemKey", "revokeSystem"])("%s removes the tokens of that system", (name) => {
    expect(handler(name)).toContain("removeTokensOf(admin, data.id)");
  });
});
