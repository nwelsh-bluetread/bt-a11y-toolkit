/**
 * Form-factor emulation presets shared by the scan engines.
 *
 * Lighthouse emulates a mobile device by default; Puppeteer (which drives axe)
 * defaults to an 800x600 desktop window. Left unset, the two engines therefore
 * audit *different renderings of the same URL*, and on a responsive site that
 * means different DOM — so findings disagree for reasons that have nothing to
 * do with their rulesets. Both engines must be pinned to the same preset.
 *
 * Values mirror Lighthouse's own `mobile` and `desktop` presets so a combined
 * scan is directly comparable to a standalone Lighthouse run.
 */

export type FormFactor = "mobile" | "desktop";

export interface FormFactorConfig {
  formFactor: FormFactor;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  /**
   * Chrome's major version in these strings drifts; Lighthouse substitutes the
   * running browser's real version. Kept literal here so axe and Lighthouse
   * send the same UA without depending on Lighthouse internals.
   */
  userAgent: string;
}

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36";

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

export const FORM_FACTORS: Record<FormFactor, FormFactorConfig> = {
  // Moto G Power — Lighthouse's default emulated device.
  mobile: {
    formFactor: "mobile",
    width: 412,
    height: 823,
    deviceScaleFactor: 1.75,
    isMobile: true,
    hasTouch: true,
    userAgent: MOBILE_UA,
  },
  desktop: {
    formFactor: "desktop",
    width: 1350,
    height: 940,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    userAgent: DESKTOP_UA,
  },
};

/** Resolve a `--form-factor` argument, falling back to mobile. */
export function resolveFormFactor(value?: string): FormFactorConfig {
  if (value === "desktop") return FORM_FACTORS.desktop;
  if (value === "mobile" || value === undefined) return FORM_FACTORS.mobile;
  throw new Error(`Unknown form factor "${value}". Expected "mobile" or "desktop".`);
}

/** Lighthouse `settings` fragment pinning it to the given form factor. */
export function lighthouseEmulationSettings(cfg: FormFactorConfig): Record<string, unknown> {
  return {
    formFactor: cfg.formFactor,
    screenEmulation: {
      mobile: cfg.isMobile,
      width: cfg.width,
      height: cfg.height,
      deviceScaleFactor: cfg.deviceScaleFactor,
      disabled: false,
    },
    emulatedUserAgent: cfg.userAgent,
  };
}

/** Puppeteer `setViewport` argument for the given form factor. */
export function puppeteerViewport(cfg: FormFactorConfig): Record<string, unknown> {
  return {
    width: cfg.width,
    height: cfg.height,
    deviceScaleFactor: cfg.deviceScaleFactor,
    isMobile: cfg.isMobile,
    hasTouch: cfg.hasTouch,
  };
}
