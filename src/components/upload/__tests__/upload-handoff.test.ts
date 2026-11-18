import { describe, expect, it } from "vitest";
import { handOverFiles, takeFiles } from "@/components/upload/upload-handoff";

const file = new File(["x"], "a.pdf", { type: "application/pdf" });

describe("upload hand-over", () => {
  it("gives the files to the record they were chosen for, once", () => {
    handOverFiles("ord-1", [file]);
    expect(takeFiles("ord-1")).toEqual([file]);
    expect(takeFiles("ord-1")).toEqual([]);
  });
  it("never gives them to another record", () => {
    handOverFiles("ord-1", [file]);
    expect(takeFiles("ord-2")).toEqual([]);
    expect(takeFiles("ord-1")).toEqual([]);
  });
});
