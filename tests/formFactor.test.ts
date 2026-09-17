import { describe, expect, it } from "vitest";
import {
  FORM_FACTORS,
  lighthouseEmulationSettings,
  puppeteerViewport,
  resolveFormFactor,
} from "../src/formFactor.js";

describe("resolveFormFactor", () => {
  it("defaults to mobile when unspecified", () => {
    expect(resolveFormFactor().formFactor).toBe("mobile");
    expect(resolveFormFactor(undefined).formFactor).toBe("mobile");
  });

  it("resolves explicit values", () => {
    expect(resolveFormFactor("mobile")).toBe(FORM_FACTORS.mobile);
    expect(resolveFormFactor("desktop")).toBe(FORM_FACTORS.desktop);
  });

  it("rejects an unknown form factor rather than silently defaulting", () => {
    expect(() => resolveFormFactor("tablet")).toThrow(/Unknown form factor "tablet"/);
  });
});

describe("engine emulation settings agree", () => {
  it.each(["mobile", "desktop"] as const)(
    "%s: Lighthouse and Puppeteer get the same dimensions",
    key => {
      const cfg = FORM_FACTORS[key];
      const lh = lighthouseEmulationSettings(cfg);
      const pptr = puppeteerViewport(cfg);
      const screen = lh.screenEmulation as Record<string, unknown>;

      expect(screen.width).toBe(pptr.width);
      expect(screen.height).toBe(pptr.height);
      expect(screen.deviceScaleFactor).toBe(pptr.deviceScaleFactor);
      expect(screen.mobile).toBe(pptr.isMobile);
      expect(lh.emulatedUserAgent).toBe(cfg.userAgent);
    }
  );

  it("does not leave Lighthouse emulation disabled", () => {
    const lh = lighthouseEmulationSettings(FORM_FACTORS.mobile);
    expect((lh.screenEmulation as Record<string, unknown>).disabled).toBe(false);
  });
});

describe("presets", () => {
  it("mobile matches Lighthouse's default emulated device", () => {
    expect(FORM_FACTORS.mobile).toMatchObject({
      width: 412,
      height: 823,
      deviceScaleFactor: 1.75,
      isMobile: true,
      hasTouch: true,
    });
    expect(FORM_FACTORS.mobile.userAgent).toMatch(/Android/);
  });

  it("desktop is not a touch device and sends a desktop UA", () => {
    expect(FORM_FACTORS.desktop).toMatchObject({
      width: 1350,
      height: 940,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
    });
    expect(FORM_FACTORS.desktop.userAgent).not.toMatch(/Mobile/);
  });

  it("the two presets are actually different renderings", () => {
    expect(FORM_FACTORS.mobile.width).not.toBe(FORM_FACTORS.desktop.width);
    expect(FORM_FACTORS.mobile.userAgent).not.toBe(FORM_FACTORS.desktop.userAgent);
  });
});
