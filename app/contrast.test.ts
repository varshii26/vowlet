import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the theme's text colours: WCAG AA is 4.5:1 for normal text. These are
 * the pairs the app really uses, read from the tokens in app/globals.css, so a
 * palette tweak that breaks readability fails here instead of in a review.
 */
const css = readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");
const token = (name: string) => {
  const match = css.match(new RegExp(String.raw`--color-${name}:\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`token --color-${name} not found`);
  return match[1];
};

const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
const luminance = (hex: string) => {
  const [r, g, b] = [0, 1, 2].map((i) => {
    const v = channel(hex, i);
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("theme contrast (WCAG AA, 4.5:1 for text)", () => {
  it.each([
    ["body text on the canvas", "ink", "canvas"],
    ["muted text on the canvas", "muted", "canvas"],
    ["muted text on a card", "muted", "surface"],
    ["muted text on a sunken area", "muted", "sunken"],
    ["accent links on the canvas", "accent", "canvas"],
    ["accent links on a card", "accent", "surface"],
    ["strong accent on its soft badge", "accent-strong", "accent-soft"],
  ])("%s", (_name, fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it("white text on the accent button", () => {
    expect(contrast("#ffffff", token("accent"))).toBeGreaterThanOrEqual(4.5);
  });
});
