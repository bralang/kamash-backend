import { getSheetsClient } from "./googleAuth.js";
import type { SheetRef } from "../config/sheets.js";
import { SHEETS, DIAGNOSES_COLUMNS } from "../config/sheets.js";

export interface SheetRow {
  /** 1-indexed row number as it appears in the actual spreadsheet (header is row 1). */
  rowNumber: number;
  row: Record<string, string>;
}

function columnIndexToLetter(index: number): string {
  let n = index + 1;
  let letters = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

async function readSheetRaw(sheetRef: SheetRef): Promise<{ header: string[]; rows: SheetRow[] }> {
  const sheets = getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetRef.spreadsheetId,
    range: sheetRef.name,
  });
  const values = data.values ?? [];
  const header = values[0] ?? [];
  const rows: SheetRow[] = values.slice(1).map((values, i) => ({
    rowNumber: i + 2, // +1 for 1-indexing, +1 for the header row
    row: Object.fromEntries(header.map((col, idx) => [col, values[idx] ?? ""])),
  }));
  return { header, rows };
}

/** Plain data read — no row numbers, matches the shape n8n's read-only webhooks returned. */
export async function getAllRows(sheetRef: SheetRef): Promise<Record<string, string>[]> {
  const { rows } = await readSheetRaw(sheetRef);
  return rows.map((r) => r.row);
}

export async function findRowByColumn(
  sheetRef: SheetRef,
  column: string,
  value: string,
): Promise<SheetRow | null> {
  const { rows } = await readSheetRaw(sheetRef);
  return rows.find((r) => r.row[column] === value) ?? null;
}

export async function findRowsByColumn(sheetRef: SheetRef, column: string, value: string): Promise<SheetRow[]> {
  const { rows } = await readSheetRaw(sheetRef);
  return rows.filter((r) => r.row[column] === value);
}

export async function appendRow(sheetRef: SheetRef, rowObject: Record<string, string>): Promise<void> {
  const sheets = getSheetsClient();
  const { header } = await readSheetRaw(sheetRef);
  const values = header.map((col) => rowObject[col] ?? "");
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetRef.spreadsheetId,
    range: sheetRef.name,
    valueInputOption: "RAW",
    requestBody: { values: [values] },
  });
}

/** Updates only the given columns on a specific row, leaving every other cell untouched. */
export async function updateRowByNumber(
  sheetRef: SheetRef,
  rowNumber: number,
  patch: Record<string, string>,
): Promise<void> {
  const sheets = getSheetsClient();
  const { header } = await readSheetRaw(sheetRef);
  const data = Object.entries(patch).map(([column, value]) => {
    const index = header.indexOf(column);
    if (index === -1) {
      throw new Error(`Unknown column "${column}" on sheet "${sheetRef.name}"`);
    }
    return {
      range: `${sheetRef.name}!${columnIndexToLetter(index)}${rowNumber}`,
      values: [[value]],
    };
  });
  if (data.length === 0) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetRef.spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
}

// ---- Typed repos ----

export const diagnosesRepo = {
  findByJobId(jobId: string): Promise<SheetRow | null> {
    return findRowByColumn(SHEETS.DIAGNOSES, DIAGNOSES_COLUMNS.JOB_ID, jobId);
  },
  updateByRowNumber(rowNumber: number, patch: Record<string, string>): Promise<void> {
    return updateRowByNumber(SHEETS.DIAGNOSES, rowNumber, patch);
  },
};
