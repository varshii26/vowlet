import { describe, expect, it } from "vitest";
import { initialsFor } from "@/lib/auth/avatar";

describe("initialsFor", () => {
  it.each([
    ["Priya & Sam", null, "PS"],
    ["Ana Maria Lopez", null, "AM"],
    ["priya sam", null, "PS"],
    ["Madonna", null, "MA"],
    ["  Jo  ", null, "JO"],
    ["Émile Zola", null, "ÉZ"],
    ["李 小龙", null, "李小"],
  ])("%s -> %s", (name, email, initials) => expect(initialsFor(name, email)).toBe(initials));

  it("falls back to the email's first letters when there is no name", () => {
    expect(initialsFor(null, "gurvi@example.com")).toBe("GU");
    expect(initialsFor("", "x@example.com")).toBe("X");
    expect(initialsFor("   ", "ana.b@example.com")).toBe("AN");
  });

  it("never returns nothing", () => {
    expect(initialsFor(null, null)).toBe("?");
    expect(initialsFor("&&", "@example.com")).toBe("?");
  });
});
