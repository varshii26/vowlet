import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("toolchain", () => {
  it("runs Vitest with Zod available", () => {
    expect(z.number().parse(1)).toBe(1);
  });
});
