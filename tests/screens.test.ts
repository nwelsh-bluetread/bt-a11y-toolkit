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
    // In navigation order: the nested Tabs navigator's screens appear where Tabs is declared.
    expect(screens.map((s) => [s.name, s.group])).toEqual([
      ["Login", "Root"],
      ["Inbox", "Root"],
      ["Settings", "Tabs"],
      ["Lazy", "Root"],
    ]);

    const login = screens.find((s) => s.name === "Login")!;
    expect(login.file).toBe("src/screens/LoginScreen.tsx");
    expect(login.files).toEqual(["src/components/Logo.tsx", "src/screens/LoginScreen.tsx"]);
    expect(login.features).toEqual(["inputs", "images", "auth"]);

    expect(screens.find((s) => s.name === "Inbox")!.features).toEqual(["images", "gestures"]);
    expect(screens.find((s) => s.name === "Settings")!.features).toEqual(["inputs"]);
    expect(screens.find((s) => s.name === "Lazy")).toMatchObject({ file: "src/screens/LazyScreen.tsx", features: ["modals"] });
  });

  it("follows only the components a screen imports from a barrel file, not the whole barrel", async () => {
    project({
      "package.json": JSON.stringify({ dependencies: { "react-native": "0.76.0" } }),
      "App.js": `
        import { createNativeStackNavigator } from "@react-navigation/native-stack";
        import Billing from "./src/screens/Billing";
        import Camera from "./src/screens/Camera";
        const Stack = createNativeStackNavigator();
        export default () => <Stack.Navigator><Stack.Screen name="Billing" component={Billing} /><Stack.Screen name="Camera" component={Camera} /></Stack.Navigator>;`,
      // Three common barrel styles in one index file.
      "src/components/index.js": `
        export { default as HeaderBackButton } from "./HeaderBackButton";
        import CameraPermsInstructions from "./CameraPermsInstructions";
        import ActiveRentalsList from "./ActiveRentalsList";
        export { CameraPermsInstructions, ActiveRentalsList };
        export * from "./forms";`,
      "src/components/HeaderBackButton.js": `import { Pressable } from "react-native";\nexport default function HeaderBackButton() { return <Pressable />; }`,
      "src/components/CameraPermsInstructions.js": `import { Image } from "react-native";\nexport default function CameraPermsInstructions() { return <Image />; }`,
      "src/components/ActiveRentalsList.js": `import { Pressable } from "react-native";\nexport default function ActiveRentalsList() { return <Pressable />; }`,
      "src/components/forms.js": `import { TextInput } from "react-native";\nexport function AmountField() { return <TextInput />; }`,
      "src/screens/Billing.js": `
        import { View } from "react-native";
        import { HeaderBackButton, AmountField } from "../components";
        export default function Billing() { return <View><HeaderBackButton /><AmountField /></View>; }`,
      "src/screens/Camera.js": `
        import * as C from "../components";
        export default function Camera() { return <C.CameraPermsInstructions />; }`,
    });

    const { screens } = await discoverScreens(root);
    const billing = screens.find((s) => s.name === "Billing")!;
    expect(billing.files).toEqual(["src/components/HeaderBackButton.js", "src/components/forms.js", "src/screens/Billing.js"]);
    expect(billing.features).toEqual(["inputs"]);
    // A namespace import really can use anything in the barrel, so it still follows all of it.
    expect(screens.find((s) => s.name === "Camera")!.files).toContain("src/components/CameraPermsInstructions.js");
  });

  it("orders screens root stack first, then each tab in declared order — not by file name", async () => {
    const screen = (name: string) => `export default function ${name}() { return null; }`;
    project({
      "package.json": JSON.stringify({ dependencies: { "react-native": "0.76.0" } }),
      // File names sort BillingTab < BottomNavigation < OrdersTab < index, which is not the app's order.
      "src/navigator/index.js": `
        import Login from "../screens/Login";
        import Main from "./BottomNavigation";
        const Stack = createNativeStackNavigator();
        export default () => <Stack.Navigator><Stack.Screen name="Login" component={Login} /><Stack.Screen name="Main" component={Main} /></Stack.Navigator>;`,
      "src/navigator/BottomNavigation/index.js": `
        import Home from "../../screens/Home";
        import OrdersTab from "../OrdersTab";
        import BillingTab from "../BillingTab";
        const Tab = createBottomTabNavigator();
        export default () => <Tab.Navigator><Tab.Screen name="Home" component={Home} /><Tab.Screen name="OrdersTab" component={OrdersTab} /><Tab.Screen name="BillingTab" component={BillingTab} /></Tab.Navigator>;`,
      "src/navigator/BillingTab.js": `
        import Billing from "../screens/Billing";
        import BillingComingSoon from "../screens/BillingComingSoon";
        import PayNow from "../screens/PayNow";
        import InvoiceHistory from "../screens/InvoiceHistory";
        const Stack = createNativeStackNavigator();
        export default () => <Stack.Navigator><Stack.Screen name="Billing" component={Billing} /><Stack.Screen name="BillingComingSoon" component={BillingComingSoon} /><Stack.Screen name="PayNow" component={PayNow} /><Stack.Screen name="InvoiceHistory" component={InvoiceHistory} /></Stack.Navigator>;`,
      "src/navigator/OrdersTab.js": `
        import AllOrders from "../screens/AllOrders";
        import OrderDetails from "../screens/OrderDetails";
        const Stack = createNativeStackNavigator();
        export default () => <Stack.Navigator><Stack.Screen name="AllOrders" component={AllOrders} /><Stack.Screen name="OrderDetails" component={OrderDetails} /></Stack.Navigator>;`,
      ...Object.fromEntries(
        ["Login", "Home", "Billing", "BillingComingSoon", "PayNow", "InvoiceHistory", "AllOrders", "OrderDetails"].map((n) => [`src/screens/${n}.js`, screen(n)]),
      ),
    });
    const { screens } = await discoverScreens(root);
    expect(screens.map((s) => [s.name, s.group])).toEqual([
      ["Login", "Root"],
      ["Home", "Main"],
      ["AllOrders", "Main › OrdersTab"],
      ["OrderDetails", "Main › OrdersTab"],
      ["Billing", "Main › BillingTab"],
      ["BillingComingSoon", "Main › BillingTab"],
      ["PayNow", "Main › BillingTab"],
      ["InvoiceHistory", "Main › BillingTab"],
    ]);
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
