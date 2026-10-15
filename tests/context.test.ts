import { describe, expect, it } from "vitest";
import type { ScreenInfo } from "../src/code-scan/screens.js";
import { applyContext, mergeContexts, parseNavigationMap, reachedFrom, UNLISTED_GROUP } from "../src/context.js";

/** A navigation map in the same shape teams write by hand (tables + a Mermaid flowchart). */
const MAP = `# Navigation Map

Every screen registered in the app's navigators.

## 1. Root stack: \`src/navigator/index.js\`

| Route name | Screen component | Deep link |
| --- | --- | --- |
| \`Login\` | \`Auth/Login\` | \`login\` |
| \`ResetTab\` _(nested stack, \`src/navigator/ResetTab.js\`)_ | — | \`reset\` |
| ↳ \`ResetPassword\` | \`Auth/ResetPassword\` | — |
| \`Loading\` | \`Auth/LoginStatus\` | \`loading\`\\* |
| \`Main\` _(bottom tabs)_ | — | \`home\` |

## 2. Main bottom tabs: \`src/navigator/Tabs/\`

| Tab → route | Screen component | Deep link |
| --- | --- | --- |
| **\`Home\`** | \`Home\` | \`home\` |
| **\`BillingTab\`** (\`BillingTab.js\`, opens on \`Billing\`) | | \`home/billing\` |
| ↳ \`Billing\` | \`Billing\` | — |
| ↳ \`PayNow\` | \`Billing/PayNow\` | — |
| **\`ProfileTab\`** | | |
| ↳ \`Accessibility\` | \`Settings/Accessibility\` | — |
| **\`SettingsTab\`** | | |
| ↳ \`Accessibility\` | \`Settings/Accessibility\` | — |
| **\`Contact Us\`** | \`Other/ContactUs\` | \`home/contact\` |

## 3. Flow diagram

\`\`\`mermaid
flowchart TD
    Start([App launch]) --> Login
    Loading["Loading<br/>(LoginStatus)"]
    Login <--> ResetPassword
    Login --> Loading
    Loading -- "has account" --> HomeScreen
    HomeScreen["Home"]
    ContactUs["Contact Us"]
    HomeScreen -- "billing enabled" --> Billing
    HomeScreen --> PayNow
    Billing --> PayNow --> Receipt
    SideMenu --> ContactUs
\`\`\`
`;

describe("parseNavigationMap", () => {
  const ctx = parseNavigationMap(MAP);
  const screen = (name: string) => ctx.screens.find((s) => s.name === name)!;

  it("reads every screen with its group, component, and deep link, skipping navigators", () => {
    expect(ctx.screens.map((s) => s.name)).toEqual(["Login", "ResetPassword", "Loading", "Home", "Billing", "PayNow", "Accessibility", "Contact Us"]);
    expect(screen("Login")).toEqual({ name: "Login", group: "Root stack", component: "Auth/Login", deepLink: "login" });
    expect(screen("ResetPassword").group).toBe("Root stack › ResetTab");
    expect(screen("Loading").deepLink).toBe("loading");
    expect(screen("Home").group).toBe("Main bottom tabs › Home");
    expect(screen("PayNow")).toMatchObject({ group: "Main bottom tabs › BillingTab", component: "Billing/PayNow" });
    expect(screen("PayNow").deepLink).toBeUndefined();
  });

  it("gives a tab's deep link to the screen it opens on, and notes routes listed twice", () => {
    expect(screen("Billing").deepLink).toBe("home/billing");
    expect(screen("Accessibility")).toMatchObject({ group: "Main bottom tabs › ProfileTab", alsoIn: ["Main bottom tabs › SettingsTab"] });
  });

  it("reads flowchart edges, chains, two-way arrows, and labels", () => {
    expect(reachedFrom(ctx, "PayNow")).toEqual(["Home", "Billing"]);
    expect(reachedFrom(ctx, "Home")).toEqual(["Loading (LoginStatus) (has account)"]);
    expect(reachedFrom(ctx, "Login")).toEqual(["App launch", "ResetPassword"]);
    expect(reachedFrom(ctx, "Contact Us")).toEqual(["SideMenu"]);
  });

  it("merges several docs", () => {
    const extra = parseNavigationMap("## Extra\n\n| Route | Component |\n| --- | --- |\n| `Help` | `Other/Help` |\n");
    expect(mergeContexts([ctx, extra]).screens.map((s) => s.name)).toContain("Help");
  });
});

describe("applyContext", () => {
  const ctx = parseNavigationMap(MAP);
  const code: ScreenInfo[] = [
    { name: "Login", kind: "mobile", file: "src/screens/Auth/Login.tsx", files: ["src/screens/Auth/Login.tsx"], features: ["inputs"] },
    { name: "PaymentScreen", kind: "mobile", file: "src/screens/Billing/PayNow/index.js", features: ["inputs"] },
    { name: "DebugMenu", kind: "mobile", file: "src/screens/Debug.tsx", features: [] },
  ];
  const merged = applyContext(code, ctx);
  const screen = (name: string) => merged.find((s) => s.name === name)!;

  it("uses the doc's names, order, and groups, with files and features from code", () => {
    expect(merged.map((s) => s.name)).toEqual([...ctx.screens.map((s) => s.name), "DebugMenu"]);
    expect(screen("Login")).toMatchObject({ file: "src/screens/Auth/Login.tsx", features: ["inputs"], group: "Root stack", deepLink: "login" });
  });

  it("matches by component path when the route name differs from the code", () => {
    expect(screen("PayNow")).toMatchObject({ file: "src/screens/Billing/PayNow/index.js", reachedFrom: ["Home", "Billing"] });
  });

  it("keeps doc-only screens (contents unknown) and puts code-only screens in their own group", () => {
    expect(screen("Billing")).toEqual({ name: "Billing", kind: "mobile", group: "Main bottom tabs › BillingTab", deepLink: "home/billing", reachedFrom: ["Home (billing enabled)"] });
    expect(screen("DebugMenu").group).toBe(UNLISTED_GROUP);
  });

  it("leaves code screens untouched when there's no context", () => {
    expect(applyContext(code, mergeContexts([]))).toEqual(code);
  });
});
