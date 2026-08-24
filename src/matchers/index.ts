/**
 * Test matchers for asserting accessibility of individual {@link A11yNode}s.
 *
 * These are framework-agnostic assertion helpers returning a `{ pass, message }`
 * result compatible with Vitest/Jest `expect.extend`. Register them with:
 *
 * ```ts
 * import { expect } from "vitest";
 * import { a11yMatchers } from "@bluetread/accessibility-toolkit/matchers";
 * expect.extend(a11yMatchers);
 * ```
 */
import type { A11yNode } from "../types.js";
import { hasAccessibleName, isHiddenFromAT, isInteractive } from "../utils.js";

export interface MatcherResult {
  pass: boolean;
  message: () => string;
}

export function toHaveAccessibleName(node: A11yNode): MatcherResult {
  const pass = hasAccessibleName(node);
  return {
    pass,
    message: () =>
      pass
        ? `expected ${node.type} not to have an accessible name`
        : `expected ${node.type} to have an accessible name (accessibilityLabel / aria-label / text)`,
  };
}

export function toHaveRole(node: A11yNode, role: string): MatcherResult {
  const actual = (node.role ?? "").toLowerCase();
  const pass = actual === role.toLowerCase();
  return {
    pass,
    message: () =>
      pass
        ? `expected ${node.type} not to have role "${role}"`
        : `expected ${node.type} to have role "${role}" but got "${node.role ?? "(none)"}"`,
  };
}

export function toBeHiddenFromAccessibility(node: A11yNode): MatcherResult {
  const pass = isHiddenFromAT(node);
  return {
    pass,
    message: () =>
      pass
        ? `expected ${node.type} not to be hidden from assistive technology`
        : `expected ${node.type} to be hidden from assistive technology`,
  };
}

export function toMeetTouchTargetSize(node: A11yNode, min = 44): MatcherResult {
  const size = node.size;
  const pass = Boolean(size && size.width >= min && size.height >= min);
  return {
    pass,
    message: () =>
      pass
        ? `expected ${node.type} not to meet the ${min}x${min} touch target size`
        : `expected ${node.type} to be at least ${min}x${min} but got ${size ? `${size.width}x${size.height}` : "(no size)"}`,
  };
}

export function toExposeState(
  node: A11yNode,
  state: keyof NonNullable<A11yNode["state"]>,
): MatcherResult {
  const pass = node.state?.[state] !== undefined;
  return {
    pass,
    message: () =>
      pass
        ? `expected ${node.type} not to expose the "${state}" state`
        : `expected ${node.type} to expose accessibilityState.${state}`,
  };
}

export function toBeInteractive(node: A11yNode): MatcherResult {
  const pass = isInteractive(node);
  return {
    pass,
    message: () =>
      pass
        ? `expected ${node.type} not to be interactive`
        : `expected ${node.type} to be interactive`,
  };
}

/** Object to pass to `expect.extend`. */
export const a11yMatchers = {
  toHaveAccessibleName,
  toHaveRole,
  toBeHiddenFromAccessibility,
  toMeetTouchTargetSize,
  toExposeState,
  toBeInteractive,
};
