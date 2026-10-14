import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isReactNativeProject, scanReactNative, type CodeScanResult } from "../src/code-scan/react-native.js";

/** A tiny React Native project with one known problem per rule (and some correct code). */
const PROJECT: Record<string, string> = {
  "package.json": JSON.stringify({ name: "acme-app", dependencies: { "react-native": "0.76.0" } }),
  "app.json": JSON.stringify({ expo: { name: "Acme", orientation: "portrait" } }, null, 2),
  "android/app/src/main/AndroidManifest.xml": `<manifest>
  <application>
    <activity android:name=".MainActivity" android:screenOrientation="portrait" />
  </application>
</manifest>`,
  "index.js": `import { Text } from "react-native";
Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.allowFontScaling = false;
`,
  "src/screens/Login.tsx": `import React from "react";
import { View, Text, TextInput, Pressable, Image, StyleSheet, Modal } from "react-native";
import Icon from "react-native-vector-icons/Feather";

export function Login({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.screenTitle}>Sign in</Text>
      <Text style={styles.faint}>Forgot password?</Text>
      <Pressable onPress={onClose} style={styles.close}>
        <Icon name="x" />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Submit form">
        <Text>Sign in</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Sign up now">
        <Text>Sign up</Text>
      </Pressable>
      <Pressable accessibilityRole="button">
        <Text>{label}</Text>
      </Pressable>
      <Pressable accessibilityRole="checkbox" accessibilityLabel="Remember me" />
      <TextInput placeholder="Email" />
      <TextInput accessibilityLabel="Password" secureTextEntry contextMenuHidden autoComplete="password" />
      <TextInput accessibilityLabel="Email address" autoComplete="email" />
      <Image source={require("./hero.png")} />
      <Image source={require("./divider.png")} accessible={false} />
      <Text allowFontScaling={false}>Fixed</Text>
      <Text maxFontSizeMultiplier={1.3}>Capped</Text>
      <View aria-hidden>
        <Pressable accessibilityRole="button" accessibilityLabel="Hidden action" />
      </View>
      <Modal visible={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ffffff" },
  screenTitle: { fontSize: 28, fontWeight: "700" },
  faint: { color: "#bbbbbb", fontSize: 14 },
  close: { width: 20, height: 20 },
});
`,
  "src/components/Good.tsx": `import React from "react";
import { Image, Pressable, Text, TextInput, TouchableOpacity, View } from "react-native";

export function Good({ rest }: { rest: object }) {
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel="Save changes" style={{ width: 48, height: 48 }}>
        <Text>Save</Text>
      </Pressable>
      <Pressable {...rest} />
      <Text accessibilityRole="header">Title</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => {}}>
        <Text text="Sign out" />
      </TouchableOpacity>
      <View {...rest}>
        <Image source={require("./icon.png")} />
      </View>
      <TextInput accessibilityLabel="Phone" keyboardType="phone-pad" textContentType="telephoneNumber" />
    </>
  );
}
`,
  "src/components/Good.test.tsx": `<Pressable />`,
  "node_modules/some-lib/index.js": `<Pressable />`,
};

let root: string;
let result: CodeScanResult;
const rules = () => result.findings.map((f) => f.ruleId);
const finding = (rule: string, file?: string) =>
  result.findings.find((f) => f.ruleId === rule && (!file || f.evidence?.file === file));

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "bt-a11y-rn-"));
  for (const [path, content] of Object.entries(PROJECT)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  result = await scanReactNative(root, { targetLevel: "AA" });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("scanReactNative", () => {
  it("scans app source but skips node_modules and test files", () => {
    expect(result.filesScanned).toBe(3);
    expect(isReactNativeProject(root)).toBe(true);
  });

  it("flags an icon-only touchable with no label or role", () => {
    const name = finding("rn-control-name");
    expect(name?.evidence?.lines).toEqual([10]);
    expect(name?.nodeId).toBe("src/screens/Login.tsx:10");
    expect(name?.wcag.map((c) => c.id)).toContain("4.1.2");
    expect(finding("rn-control-role")?.evidence?.lines).toEqual([10]);
  });

  it("does not guess when text is dynamic or props are spread", () => {
    // <Text>{label}</Text> and {...rest} should produce no name findings.
    expect(result.findings.filter((f) => f.ruleId === "rn-control-name")).toHaveLength(1);
    expect(finding("rn-image-alt", "src/components/Good.tsx")).toBeUndefined();
    expect(finding("rn-control-role", "src/components/Good.tsx")).toBeUndefined();
  });

  it("flags label-in-name mismatches but accepts labels that contain the visible text", () => {
    const f = finding("rn-label-in-name");
    expect(f?.evidence?.lines).toEqual([13]);
    expect(f?.description).toContain('"Sign in"');
  });

  it("flags stateful roles without state, hidden controls, and small targets", () => {
    expect(finding("rn-control-state")?.evidence?.lines).toEqual([22]);
    expect(finding("rn-hidden-control")?.evidence?.lines).toEqual([31]);
    expect(finding("rn-target-size")?.evidence?.lines).toEqual([10]);
  });

  it("checks inputs for labels, autofill purpose, and paste blocking", () => {
    expect(finding("rn-input-label")?.description).toContain('placeholder ("Email")');
    expect(finding("rn-input-purpose")?.evidence?.lines).toEqual([23]);
    expect(finding("rn-paste-blocked")?.evidence?.lines).toEqual([24]);
    expect(finding("rn-input-purpose", "src/components/Good.tsx")).toBeUndefined();
  });

  it("flags images without alternatives unless marked decorative", () => {
    expect(finding("rn-image-alt")?.evidence?.lines).toEqual([26]);
  });

  it("flags disabled and capped font scaling, including app-wide defaults", () => {
    expect(finding("rn-font-scaling")?.evidence?.lines).toEqual([28]);
    expect(finding("rn-font-scaling-cap")?.evidence?.lines).toEqual([29]);
    expect(finding("rn-font-scaling-global")).toMatchObject({ severity: "critical", nodeId: "index.js:3" });
  });

  it("resolves StyleSheet styles for contrast and heading checks", () => {
    expect(finding("rn-contrast")?.description).toContain("#bbbbbb on #ffffff");
    expect(finding("rn-heading-role")?.evidence?.lines).toEqual([8]);
    expect(finding("rn-heading-role", "src/components/Good.tsx")).toBeUndefined();
  });

  it("reads native config for orientation locks, tagged per platform", () => {
    const locks = result.findings.filter((f) => f.ruleId === "rn-orientation-lock");
    expect(locks.map((f) => f.evidence?.file).sort()).toEqual(["android/app/src/main/AndroidManifest.xml", "app.json"]);
    expect(locks.find((f) => f.evidence?.file?.toString().startsWith("android"))?.platforms).toEqual(["android"]);
  });

  it("raises signals for things a tester must verify", () => {
    const ids = result.signals.map((s) => s.id);
    expect(ids).toContain("modals");
    expect(ids).toContain("no-announcements");
  });

  it("reports which criteria it checked, scoped to the target level", () => {
    expect(result.checked).toEqual(expect.arrayContaining(["1.1.1", "1.3.4", "1.3.5", "1.4.3", "1.4.4", "2.5.3", "2.5.8", "3.3.8", "4.1.2"]));
    expect(result.checked).not.toContain("2.3.3"); // AAA-only rule
    expect(rules()).not.toContain("rn-reduce-motion");
  });
});
