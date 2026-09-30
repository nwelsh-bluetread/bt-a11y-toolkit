/**
 * React Native adapter tests.
 *
 * The adapter is structurally typed against `react-test-renderer`, so these
 * fixtures are hand-built instance trees — no React, no RN, no renderer needed.
 */
import { describe, it, expect } from "vitest";
import {
  toA11yNode,
  toA11yTree,
  flattenStyle,
  type RnTestInstance,
} from "../src/react-native/index.js";

function el(
  type: string,
  props: Record<string, unknown> = {},
  children: Array<RnTestInstance | string> = [],
): RnTestInstance {
  return { type, props, children };
}

describe("flattenStyle", () => {
  it("returns undefined for nothing", () => {
    expect(flattenStyle(undefined)).toBeUndefined();
    expect(flattenStyle(null)).toBeUndefined();
    expect(flattenStyle(false)).toBeUndefined();
  });

  it("flattens nested arrays, later entries winning", () => {
    expect(flattenStyle([{ color: "red" }, [{ color: "blue" }, { width: 10 }]])).toEqual({
      color: "blue",
      width: 10,
    });
  });

  it("skips falsy entries from conditional styles", () => {
    expect(flattenStyle([{ color: "red" }, false, null, undefined])).toEqual({ color: "red" });
  });

  it("skips opaque style handles it cannot resolve", () => {
    expect(flattenStyle([42, { color: "red" }])).toEqual({ color: "red" });
  });
});

describe("toA11yNode naming", () => {
  it("prefers accessibilityLabel", () => {
    const node = toA11yNode(el("View", { accessibilityLabel: "Delivered" }, ["Shipped"]));
    expect(node.accessibleName).toBe("Delivered");
  });

  it("falls back to aria-label", () => {
    expect(toA11yNode(el("View", { "aria-label": "Close" })).accessibleName).toBe("Close");
  });

  it("derives a pressable's name from descendant text", () => {
    const button = el("View", { accessibilityRole: "button", onPress() {} }, [
      el("Text", {}, ["Save changes"]),
    ]);
    expect(toA11yNode(button).accessibleName).toBe("Save changes");
  });

  it("leaves an empty element unnamed", () => {
    expect(toA11yNode(el("View", { onPress() {} })).accessibleName).toBeUndefined();
  });

  it("separates direct text from descendant text", () => {
    const node = toA11yNode(el("Text", {}, ["Hello ", el("Text", {}, ["world"])]));
    expect(node.text).toBe("Hello ");
    expect(node.accessibleName).toBe("Hello world");
  });
});

describe("toA11yNode types and roles", () => {
  it("maps accessibilityRole onto the normalized type", () => {
    expect(toA11yNode(el("View", { accessibilityRole: "header" })).type).toBe("heading");
    expect(toA11yNode(el("View", { accessibilityRole: "adjustable" })).type).toBe("slider");
  });

  it("keeps the raw role", () => {
    expect(toA11yNode(el("View", { accessibilityRole: "button" })).role).toBe("button");
  });

  it("infers a type from the component name", () => {
    expect(toA11yNode(el("TextInput")).type).toBe("textinput");
    expect(toA11yNode(el("Image")).type).toBe("image");
    expect(toA11yNode(el("Text")).type).toBe("text");
    expect(toA11yNode(el("View")).type).toBe("view");
  });

  it("reads displayName from a component type", () => {
    const node = toA11yNode({ type: { displayName: "RCTImageView" }, props: {}, children: [] });
    expect(node.type).toBe("image");
  });
});

describe("toA11yNode interactivity and state", () => {
  it("treats onPress, onLongPress, and role=button as interactive", () => {
    expect(toA11yNode(el("View", { onPress() {} })).interactive).toBe(true);
    expect(toA11yNode(el("View", { onLongPress() {} })).interactive).toBe(true);
    expect(toA11yNode(el("View", { role: "button" })).interactive).toBe(true);
    expect(toA11yNode(el("View")).interactive).toBe(false);
  });

  it("treats a text input as interactive", () => {
    expect(toA11yNode(el("TextInput")).interactive).toBe(true);
  });

  it("reads accessibilityState flags", () => {
    const node = toA11yNode(
      el("View", { accessibilityState: { disabled: true, expanded: false, checked: "mixed" } }),
    );
    expect(node.state?.disabled).toBe(true);
    expect(node.state?.expanded).toBe(false);
    expect(node.state?.checked).toBe("mixed");
  });

  it("falls back to the disabled prop", () => {
    expect(toA11yNode(el("View", { disabled: true })).state?.disabled).toBe(true);
  });

  it("detects every way of hiding a node from assistive tech", () => {
    expect(
      toA11yNode(el("View", { importantForAccessibility: "no-hide-descendants" })).hiddenFromAT,
    ).toBe(true);
    expect(toA11yNode(el("View", { "aria-hidden": true })).hiddenFromAT).toBe(true);
    expect(toA11yNode(el("View", { accessibilityElementsHidden: true })).hiddenFromAT).toBe(true);
    expect(toA11yNode(el("View")).hiddenFromAT).toBe(false);
  });
});

describe("toA11yNode sizing", () => {
  it("reads declared dimensions", () => {
    expect(toA11yNode(el("View", { style: { width: 44, height: 44 } })).size).toEqual({
      width: 44,
      height: 44,
    });
  });

  it("adds a numeric hitSlop on every edge", () => {
    const node = toA11yNode(el("View", { style: { width: 32, height: 32 }, hitSlop: 8 }));
    expect(node.size).toEqual({ width: 48, height: 48 });
  });

  it("adds a per-edge hitSlop", () => {
    const node = toA11yNode(
      el("View", { style: { width: 30, height: 30 }, hitSlop: { top: 5, bottom: 5, left: 2 } }),
    );
    expect(node.size).toEqual({ width: 32, height: 40 });
  });

  it("leaves size unknown when layout would be needed", () => {
    expect(toA11yNode(el("View", { style: { flex: 1, padding: 12 } })).size).toBeUndefined();
  });

  it("accepts numeric strings", () => {
    expect(toA11yNode(el("View", { style: { width: "20", height: "20" } })).size).toEqual({
      width: 20,
      height: 20,
    });
  });
});

describe("toA11yNode colors", () => {
  it("inherits the nearest ancestor background", () => {
    const tree = toA11yNode(
      el("View", { style: { backgroundColor: "#092846" } }, [
        el("Text", { style: { color: "#007867", fontSize: 13, fontWeight: "bold" } }, ["Terms"]),
      ]),
    );
    expect(tree.children?.[0]?.colors).toEqual({
      foreground: "#007867",
      background: "#092846",
      fontSize: 13,
      bold: true,
    });
  });

  it("treats numeric weights >= 700 as bold", () => {
    const node = toA11yNode(el("Text", { style: { color: "#000", fontWeight: "700" } }));
    expect(node.colors?.bold).toBe(true);
  });

  it("omits colors entirely when there is nothing to check", () => {
    expect(toA11yNode(el("View", { style: { margin: 4 } })).colors).toBeUndefined();
  });
});

describe("toA11yTree", () => {
  it("walks a render result from the root", () => {
    const tree = toA11yTree({
      UNSAFE_root: el("View", {}, [el("Text", { testID: "greeting" }, ["Hi"])]),
    });
    expect(tree.children?.[0]?.id).toBe("greeting");
  });

  it("uses an injected flattener", () => {
    const calls: unknown[] = [];
    const tree = toA11yTree(
      { UNSAFE_root: el("View", { style: 7 }, [el("Text", { style: 9 })]) },
      {
        flatten: (style) => {
          calls.push(style);
          return { width: 10, height: 10 };
        },
      },
    );
    // Applied at the root and passed down to children.
    expect(calls).toEqual([7, 9]);
    expect(tree.children?.[0]?.size).toEqual({ width: 10, height: 10 });
  });
});

describe("one control, one node", () => {
  /**
   * A wrapper component, the Touchable it renders, and the host view all carry
   * the same handler. Only the innermost should count as the control.
   */
  it("marks only the innermost node of a shared-handler chain interactive", () => {
    const onPress = () => {};
    const tree = toA11yNode({
      type: "View",
      props: {},
      children: [
        {
          type: "TabItem",
          props: { onPress },
          children: [
            {
              type: "TouchableOpacity",
              props: { onPress },
              children: [{ type: "View", props: { onPress, accessibilityRole: "button" }, children: ["Pay now"] }],
            },
          ],
        },
      ],
    });

    const interactive: string[] = [];
    const walk = (n: { interactive?: boolean; role?: string; children?: unknown[] }): void => {
      if (n.interactive) interactive.push(n.role ?? "none");
      for (const c of (n.children ?? []) as Array<typeof n>) walk(c);
    };
    walk(tree);

    expect(interactive).toEqual(["button"]);
  });

  it("keeps distinct controls separate", () => {
    const tree = toA11yNode({
      type: "View",
      props: {},
      children: [
        { type: "TouchableOpacity", props: { onPress: () => {} }, children: ["One"] },
        { type: "TouchableOpacity", props: { onPress: () => {} }, children: ["Two"] },
      ],
    });

    expect((tree.children ?? []).filter((c) => c.interactive)).toHaveLength(2);
  });

  it("leaves a lone pressable interactive", () => {
    const tree = toA11yNode({ type: "TouchableOpacity", props: { onPress: () => {} }, children: ["Go"] });
    expect(tree.interactive).toBe(true);
  });
});

describe("component paths", () => {
  it("records where each node sits in the tree", () => {
    const tree = toA11yNode({
      type: "Layout",
      props: {},
      children: [
        {
          type: "ScrollView",
          props: {},
          children: [{ type: "TouchableOpacity", props: { onPress: () => {} }, children: ["Pay"] }],
        },
      ],
    });

    expect(tree.path).toBe("Layout");
    expect(tree.children?.[0]?.children?.[0]?.path).toBe("Layout > ScrollView > TouchableOpacity");
  });

  it("keeps only the trailing segments of a deep path", () => {
    const deep = ["A", "B", "C", "D", "E", "F", "G"].reduceRight<Record<string, unknown>>(
      (child, type) => ({ type, props: {}, children: [child] }),
      { type: "Leaf", props: {}, children: [] },
    );

    const leafPath = (function findLeaf(node: { path?: string; children?: unknown[] }): string {
      const children = (node.children ?? []) as Array<typeof node>;
      return children.length ? findLeaf(children[0]!) : (node.path ?? "");
    })(toA11yNode(deep as never));

    expect(leafPath).toBe("D > E > F > G > Leaf");
  });
});
