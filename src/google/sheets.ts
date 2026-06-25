import type { Env } from "../config";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

/** Column order of the "MF Transactions" sheet. */
export type TxRow = [date: string, scheme: string, amount: string, units: string, nav: string];

export interface SheetLayout {
  headerRowIndex: number; // 0-based grid index of the header row
  dataRows: string[][]; // non-empty rows below the header
}

async function sheetsFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`Sheets ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

/**
 * Locate the header row dynamically (the sheet keeps intentional blank/note rows
 * above it, so the header is not at a fixed row number) and return the data rows
 * below it.
 */
export async function getSheetLayout(token: string, env: Env): Promise<SheetLayout> {
  const range = `${env.SHEET_TAB}!A1:E1000`;
  const data = await sheetsFetch<{ values?: string[][] }>(
    token,
    `/${env.SPREADSHEET_ID}/values/${encodeURIComponent(range)}`,
  );
  const rows = data.values ?? [];

  const headerRowIndex = rows.findIndex(
    (r) =>
      (r[0] ?? "").trim().toLowerCase() === "order date" &&
      (r[1] ?? "").trim().toLowerCase() === "scheme name",
  );
  if (headerRowIndex === -1) {
    throw new Error("Could not locate the header row (Order Date | Scheme Name | …) in the sheet.");
  }

  const dataRows = rows
    .slice(headerRowIndex + 1)
    .filter((r) => r.some((c) => (c ?? "").trim() !== ""));

  return { headerRowIndex, dataRows };
}

/** Insert a transaction as a new row directly below the header (newest-first). */
export async function insertRowBelowHeader(
  token: string,
  env: Env,
  headerRowIndex: number,
  row: TxRow,
): Promise<void> {
  const gridIndex = headerRowIndex + 1; // 0-based position for the new row

  await sheetsFetch(token, `/${env.SPREADSHEET_ID}:batchUpdate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          insertDimension: {
            range: {
              sheetId: Number(env.SHEET_GID),
              dimension: "ROWS",
              startIndex: gridIndex,
              endIndex: gridIndex + 1,
            },
            inheritFromBefore: false,
          },
        },
      ],
    }),
  });

  const rowNumber = gridIndex + 1; // 1-based row for the A1 range
  const range = `${env.SHEET_TAB}!A${rowNumber}:E${rowNumber}`;
  await sheetsFetch(
    token,
    `/${env.SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    },
  );
}

/** Dedup key = Order Date + Scheme Name + Units (columns A, B, D). */
export function rowKey(date: string, scheme: string, units: string): string {
  return `${date.trim()}|${scheme.trim().toLowerCase()}|${units.trim()}`;
}

export function isDuplicate(existing: string[][], date: string, scheme: string, units: string): boolean {
  const key = rowKey(date, scheme, units);
  return existing.some((r) => rowKey(r[0] ?? "", r[1] ?? "", r[3] ?? "") === key);
}
