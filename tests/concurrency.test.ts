import { describe, it, expect } from "vitest";
import { mapWithConcurrency, resolveConcurrency } from "../src/concurrency.js";

describe("resolveConcurrency", () => {
  it("defaults to serial when unset", () => {
    expect(resolveConcurrency(undefined)).toBe(1);
  });

  it("parses a numeric string", () => {
    expect(resolveConcurrency("6")).toBe(6);
  });

  it("rejects junk, zero, and negatives", () => {
    expect(resolveConcurrency("banana")).toBe(1);
    expect(resolveConcurrency("0")).toBe(1);
    expect(resolveConcurrency(-4)).toBe(1);
  });

  it("caps at the maximum", () => {
    expect(resolveConcurrency("500")).toBe(16);
    expect(resolveConcurrency("500", 4)).toBe(4);
  });

  it("floors fractional values", () => {
    expect(resolveConcurrency(3.7)).toBe(3);
  });
});

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const delays = [40, 5, 25, 1];
    const result = await mapWithConcurrency(delays, 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(result).toEqual([0, 1, 2, 3]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([...Array(12).keys()], 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBe(3);
  });

  it("visits every item exactly once", async () => {
    const seen: number[] = [];
    await mapWithConcurrency([...Array(20).keys()], 5, async (n) => {
      seen.push(n);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([...Array(20).keys()]);
  });

  it("handles an empty input", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it("runs serially when the limit is 1", async () => {
    const order: string[] = [];
    await mapWithConcurrency([30, 1], 1, async (ms, i) => {
      order.push(`start${i}`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`end${i}`);
    });
    expect(order).toEqual(["start0", "end0", "start1", "end1"]);
  });

  it("propagates a rejection", async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
