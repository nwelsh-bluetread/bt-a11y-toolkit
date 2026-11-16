/**
 * Reading tables quickly: VoiceOver says where it is in a table ("row 4 of 20,
 * column 1 of 5"), so a full read can stop after a few rows and skip the rest
 * of the cells without capturing what's said in them.
 */

export interface TablePosition {
  row: number;
  rows: number;
  column?: number;
  columns?: number;
}

/** Rows read in full, counting the header row: the header plus two data rows. */
export const TABLE_ROWS_READ = 3;

/** Where VoiceOver is in a table, from what it said; undefined when it isn't in a table cell. */
export function tablePosition(spoken: string): TablePosition | undefined {
  const row = /\brow (\d+) of (\d+)\b/i.exec(spoken);
  if (!row) return undefined;
  const col = /\bcolumn (\d+) of (\d+)\b/i.exec(spoken);
  return {
    row: Number(row[1]),
    rows: Number(row[2]),
    ...(col ? { column: Number(col[1]), columns: Number(col[2]) } : {}),
  };
}

/**
 * How many more VoiceOver moves leave the table from a cell past the rows to read,
 * or 0 to keep reading. Counts one move per cell; cells with links or buttons
 * take extra moves, so callers check again after skipping. Without a column
 * count, skips one row's worth at a time (columns unknown: a single cell).
 */
export function cellsToSkip(pos: TablePosition, rowsToRead = TABLE_ROWS_READ): number {
  if (pos.row <= rowsToRead || pos.rows <= rowsToRead) return 0;
  const columns = pos.columns ?? 1;
  const column = pos.column ?? 1;
  return (pos.rows - pos.row) * columns + (columns - column);
}
