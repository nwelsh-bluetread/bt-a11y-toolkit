import type { A11yNode } from "./types.js";

/** Flatten a node tree into a depth-first list of nodes. */
export function flatten(root: A11yNode | A11yNode[]): A11yNode[] {
  const roots = Array.isArray(root) ? root : [root];
  const out: A11yNode[] = [];
  const stack = [...roots].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    out.push(node);
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]!);
      }
    }
  }
  return out;
}

/** Element types that are considered interactive by default. */
const INTERACTIVE_TYPES = new Set([
  "button",
  "link",
  "textinput",
  "input",
  "switch",
  "checkbox",
  "radio",
  "slider",
  "tab",
  "menuitem",
  "combobox",
]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "switch",
  "checkbox",
  "radio",
  "slider",
  "tab",
  "menuitem",
  "adjustable",
  "combobox",
  "spinbutton",
]);

/** Determine whether a node is interactive, honoring explicit flags. */
export function isInteractive(node: A11yNode): boolean {
  if (typeof node.interactive === "boolean") return node.interactive;
  if (node.role && INTERACTIVE_ROLES.has(node.role.toLowerCase())) return true;
  if (node.type && INTERACTIVE_TYPES.has(node.type.toLowerCase())) return true;
  if (typeof node.props?.onPress === "function") return true;
  if (typeof node.props?.onClick === "function") return true;
  return false;
}

/** True when a node is hidden from assistive technology. */
export function isHiddenFromAT(node: A11yNode): boolean {
  if (node.hiddenFromAT) return true;
  if (node.props?.["aria-hidden"] === true) return true;
  if (node.props?.importantForAccessibility === "no-hide-descendants") return true;
  return false;
}

/** Whether a node exposes any accessible name. */
export function hasAccessibleName(node: A11yNode): boolean {
  return Boolean(
    (node.accessibleName && node.accessibleName.trim()) ||
      (node.text && node.text.trim()) ||
      (node.value?.text && node.value.text.trim()),
  );
}

const TEXT_TYPES = new Set(["text", "heading", "header", "label", "paragraph"]);
const IMAGE_TYPES = new Set(["image", "img", "icon", "svg"]);

export function isTextNode(node: A11yNode): boolean {
  return TEXT_TYPES.has(node.type.toLowerCase());
}

export function isImageNode(node: A11yNode): boolean {
  return IMAGE_TYPES.has(node.type.toLowerCase());
}
