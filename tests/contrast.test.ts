import { describe, it, expect } from "vitest";
import { contrastRatio, isLargeText, parseHex, requiredContrast } from "../src/contrast.js";

describe("parseHex", () => {
  it("parses shorthand, full, and alpha hex", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("#000000")).toEqual([0, 0, 0]);
    expect(parseHex("#ff0000ff")).toEqual([255, 0, 0]);
  });

  it("returns null for invalid input", () => {
    expect(parseHex("nope")).toBeNull();
    expect(parseHex("#12")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("computes 21:1 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("computes 1:1 for identical colors", () => {
    expect(contrastRatio("#123456", "#123456")).toBeCloseTo(1, 5);
  });

  it("returns null for unparseable colors", () => {
    expect(contrastRatio("xyz", "#fff")).toBeNull();
  });
});

describe("isLargeText", () => {
  it("treats >=18pt as large", () => {
    expect(isLargeText(18)).toBe(true);
    expect(isLargeText(16)).toBe(false);
  });
  it("treats >=14pt bold as large", () => {
    expect(isLargeText(14, true)).toBe(true);
    expect(isLargeText(14, false)).toBe(false);
  });
});

describe("requiredContrast", () => {
  it("returns correct thresholds", () => {
    expect(requiredContrast("AA", false)).toBe(4.5);
    expect(requiredContrast("AA", true)).toBe(3);
    expect(requiredContrast("AAA", false)).toBe(7);
    expect(requiredContrast("AAA", true)).toBe(4.5);
  });
});
