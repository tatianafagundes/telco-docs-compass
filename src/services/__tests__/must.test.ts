import { describe, expect, it } from "vitest";
import { DatabaseError, must } from "@/services/shared/must";

describe("must", () => {
  it("returns the data when the database reported no error", () => {
    expect(must({ data: [1, 2], error: null }, "reading numbers")).toEqual([1, 2]);
  });

  it("returns null data as is: no rows is not an error", () => {
    expect(must({ data: null, error: null }, "reading one row")).toBeNull();
  });

  it("throws when the database reported an error, naming the step but not the database message", () => {
    const failing = () =>
      must({ data: null, error: { message: "secret table detail" } }, "saving a hold");
    expect(failing).toThrow(DatabaseError);
    expect(failing).toThrow("saving a hold");
    expect(failing).not.toThrow("secret table detail");
  });
});
