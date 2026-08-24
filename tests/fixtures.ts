import type { A11yNode } from "../src/types.js";

/** A small tree with a mix of passing and failing nodes, for testing. */
export const sampleTree: A11yNode = {
  type: "view",
  id: "root",
  children: [
    // Button with no accessible name and no role -> 2 findings
    { type: "button", id: "btn-bad", interactive: true, size: { width: 20, height: 20 } },
    // Good button
    {
      type: "button",
      id: "btn-good",
      role: "button",
      accessibleName: "Submit",
      size: { width: 48, height: 48 },
    },
    // Meaningful image with no alt -> finding
    { type: "image", id: "img-bad" },
    // Decorative image not hidden -> finding (decorative + image rules)
    { type: "image", id: "img-decorative", decorative: true },
    // Input without label -> finding
    { type: "textinput", id: "input-bad" },
    // Input with label
    { type: "textinput", id: "input-good", accessibleName: "Email" },
    // Low-contrast text -> finding
    {
      type: "text",
      id: "text-low",
      text: "Hello",
      colors: { foreground: "#aaaaaa", background: "#ffffff", fontSize: 14 },
    },
    // Good contrast text
    {
      type: "text",
      id: "text-good",
      text: "Hello",
      colors: { foreground: "#000000", background: "#ffffff", fontSize: 14 },
    },
  ],
};
