import { describe, expect, it } from "vitest";
import { cellsToSkip, tablePosition } from "../src/screen-reader/table.js";

describe("reading tables quickly", () => {
  it("reads where VoiceOver is from what it said", () => {
    expect(tablePosition("Jane Doe, row 4 of 20, column 1 of 5")).toEqual({ row: 4, rows: 20, column: 1, columns: 5 });
    expect(tablePosition("Name, column header, row 1 of 20")).toEqual({ row: 1, rows: 20 });
    expect(tablePosition("Save, button")).toBeUndefined();
  });

  it("reads the header and two data rows, then skips to the end of the table", () => {
    expect(cellsToSkip({ row: 1, rows: 20, column: 1, columns: 5 })).toBe(0);
    expect(cellsToSkip({ row: 3, rows: 20, column: 1, columns: 5 })).toBe(0);
    // At row 4's first cell: rows 5-20 (16 × 5 cells) plus the rest of row 4 (4 cells).
    expect(cellsToSkip({ row: 4, rows: 20, column: 1, columns: 5 })).toBe(84);
    // A short table is read in full.
    expect(cellsToSkip({ row: 3, rows: 3, column: 1, columns: 5 })).toBe(0);
    // Columns unknown: skip one move per remaining row, then check again.
    expect(cellsToSkip({ row: 4, rows: 20 })).toBe(16);
  });
});
