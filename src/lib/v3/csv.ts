/**
 * A spreadsheet file (CSV) from rows of plain values, and a way to hand it to the browser as a
 * download. `toCsv` is pure; `downloadText` touches the DOM.
 *
 * The file opens cleanly in Excel, Numbers, Google Sheets and LibreOffice: a UTF-8 byte-order mark
 * (so accented letters survive Excel), CRLF line ends, every cell quoted (quotes doubled), and a
 * leading apostrophe on any text that a spreadsheet would otherwise run as a formula.
 */

export type CsvCell = string | number | null | undefined;

/** Text that starts like a formula (=SUM, +1, -1, @cmd) or with a tab/return that could hide one. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: CsvCell): string {
  let text: string;
  if (value === null || value === undefined) text = "";
  else if (typeof value === "number") text = Number.isFinite(value) ? String(value) : "";
  // a real number is never a formula (-5 is just -5); only text can be one
  else text = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Every key, in the order a key first appears over all rows. */
function unionOfKeys(rows: Record<string, CsvCell>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

/**
 * Rows as CSV text. `columns` picks and orders the columns (missing values become empty cells);
 * without it, the columns are the union of the rows' keys in order of first appearance.
 */
export function toCsv(rows: Record<string, string | number | null | undefined>[], columns?: string[]): string {
  const cols = columns ?? unionOfKeys(rows);
  const lines = [cols.map(cell).join(","), ...rows.map((row) => cols.map((c) => cell(row[c])).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Hands `text` to the browser as a file to save, through a temporary link to an in-memory blob. */
export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // some browsers start the save a moment after the click: revoke once it has had the chance
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
