import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectFeatures, discoverScreens, screensFromUrls } from "../src/code-scan/screens.js";

let root: string;
function project(files: Record<string, string>): string {
  root = mkdtempSync(join(tmpdir(), "bt-a11y-screens-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("discoverScreens — React Navigation", () => {
  it("finds <Stack.Screen> screens through barrels and path aliases, and skips nested navigators", async () => {
    project({
      "package.json": JSON.stringify({ dependencies: { "react-native": "0.76.0" } }),
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] }, jsx: "react-native" } }),
      "src/navigation/AppNavigator.tsx": `
        import { createNativeStackNavigator } from "@react-navigation/native-stack";
        import { LoginScreen, InboxScreen } from "@/screens";
        import { TabsNavigator } from "./TabsNavigator";
        const Stack = createNativeStackNavigator();
        export function AppNavigator() {
          return (
            <Stack.Navigator>
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="Inbox" component={InboxScreen} />
              <Stack.Screen name="Tabs" component={TabsNavigator} />
              <Stack.Screen name="Lazy" getComponent={() => require("../screens/LazyScreen").default} />
            </Stack.Navigator>
          );
        }`,
      "src/navigation/TabsNavigator.tsx": `
        import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
        import SettingsScreen from "../screens/SettingsScreen";
        const Tab = createBottomTabNavigator();
        export function TabsNavigator() {
          return <Tab.Navigator><Tab.Screen name="Settings" component={SettingsScreen} /></Tab.Navigator>;
        }`,
      "src/screens/index.ts": `export * from "./LoginScreen";\nexport { InboxScreen } from "./InboxScreen";`,
      "src/screens/LoginScreen.tsx": `
        import { TextInput, View } from "react-native";
        import { Logo } from "@/components/Logo";
        export function LoginScreen() {
          return <View><Logo /><TextInput secureTextEntry /></View>;
        }`,
      "src/screens/InboxScreen.tsx": `
        import { FlatList } from "react-native";
        import { Swipeable } from "react-native-gesture-handler";
        import { Logo } from "@/components/Logo";
        export function InboxScreen() { return <Swipeable><Logo /><FlatList data={[]} renderItem={() => null} /></Swipeable>; }`,
      "src/screens/SettingsScreen.tsx": `import { Switch } from "react-native";\nexport default function SettingsScreen() { return <Switch />; }`,
      "src/screens/LazyScreen.tsx": `import { Modal } from "react-native";\nexport default function LazyScreen() { return <Modal />; }`,
      "src/components/Logo.tsx": `import { Image } from "react-native";\nexport function Logo() { return <Image source={require("./logo.png")} />; }`,
      "src/i18n/en.ts": `export default { login: "Log in", password: "Password" };`,
    });

    const { screens, method } = await discoverScreens(root);
    expect(method).toBe("react-navigation");
    expect(screens.map((s) => s.name)).toEqual(["Login", "Inbox", "Lazy", "Settings"]);

    const login = screens.find((s) => s.name === "Login")!;
    expect(login.file).toBe("src/screens/LoginScreen.tsx");
    expect(login.files).toEqual(["src/components/Logo.tsx", "src/screens/LoginScreen.tsx"]);
    expect(login.features).toEqual(["inputs", "images", "auth"]);

    expect(screens.find((s) => s.name === "Inbox")!.features).toEqual(["images", "gestures"]);
    expect(screens.find((s) => s.name === "Settings")!.features).toEqual(["inputs"]);
    expect(screens.find((s) => s.name === "Lazy")).toMatchObject({ file: "src/screens/LazyScreen.tsx", features: ["modals"] });
  });

  it("reads static navigator configs", async () => {
    project({
      "package.json": JSON.stringify({ dependencies: { "react-native": "0.76.0" } }),
      "App.tsx": `
        import { createNativeStackNavigator } from "@react-navigation/native-stack";
        import Home from "./src/Home";
        import Profile from "./src/Profile";
        const RootStack = createNativeStackNavigator({ screens: { Home, Profile: { screen: Profile } } });`,
      "src/Home.tsx": `export default function Home() { return null; }`,
      "src/Profile.tsx": `export default function Profile() { return null; }`,
    });
    const { screens } = await discoverScreens(root);
    expect(screens.map((s) => [s.name, s.file])).toEqual([
      ["Home", "src/Home.tsx"],
      ["Profile", "src/Profile.tsx"],
    ]);
  });
});

describe("discoverScreens — expo-router and fallback", () => {
  it("turns expo-router files into routes, skipping layouts and groups", async () => {
    project({
      "package.json": JSON.stringify({ dependencies: { "react-native": "0.76.0", "expo-router": "4.0.0" } }),
      "app/_layout.tsx": `export default function Layout() { return null; }`,
      "app/(tabs)/index.tsx": `export default function Home() { return null; }`,
      "app/(tabs)/settings.tsx": `export default function Settings() { return null; }`,
      "app/profile/[id].tsx": `export default function Profile() { return null; }`,
      "app/+not-found.tsx": `export default function NotFound() { return null; }`,
    });
    const { screens, method } = await discoverScreens(root);
    expect(method).toBe("expo-router");
    expect(screens.map((s) => s.name).sort()).toEqual(["/", "/profile/[id]", "/settings"]);
  });

  it("falls back to screens folders and *Screen files", async () => {
    project({
      "package.json": JSON.stringify({ dependencies: { "react-native": "0.76.0" } }),
      "src/screens/Checkout.tsx": `export default function Checkout() { return null; }`,
      "src/features/cart/CartScreen.tsx": `export default function CartScreen() { return null; }`,
      "src/components/Button.tsx": `export function Button() { return null; }`,
    });
    const { screens, method } = await discoverScreens(root);
    expect(method).toBe("folders");
    expect(screens.map((s) => s.name).sort()).toEqual(["Cart", "Checkout"]);
  });
});

describe("helpers", () => {
  it("ignores feature words in non-UI files (translations, types)", () => {
    expect(detectFeatures([`export default { signIn: "Sign in", password: "Password" }`])).toEqual([]);
    expect(detectFeatures([`<TextInput secureTextEntry />`])).toEqual(["inputs", "auth"]);
  });

  it("names web pages by path", () => {
    expect(screensFromUrls(["https://acme.test/", "https://acme.test/about?x=1"]).map((s) => s.name)).toEqual(["/", "/about?x=1"]);
  });
});
