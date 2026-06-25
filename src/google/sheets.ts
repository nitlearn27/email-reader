import type { Destination } from "../rules";

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

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

/** 0-based column index → A1 column letters (0→A, 25→Z, 26→AA). */
function colLetter(index: number): string {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/**
 * Locate the header row dynamically (sheets keep intentional blank/note rows above
 * it, so the header is not at a fixed row number) and return the data rows below it.
 * `headerMatch` is the list of lowercased leading cells that identify the header.
 */
export async function getSheetLayout(
  token: string,
  dest: Destination,
  headerMatch: string[],
  width: number,
): Promise<SheetLayout> {
  const lastCol = colLetter(width - 1);
  const range = `${dest.tab}!A1:${lastCol}1000`;
  const data = await sheetsFetch<{ values?: string[][] }>(
    token,
    `/${dest.spreadsheetId}/values/${encodeURIComponent(range)}`,
  );
  const rows = data.values ?? [];

  const headerRowIndex = rows.findIndex((r) =>
    headerMatch.every((h, i) => (r[i] ?? "").trim().toLowerCase() === h),
  );
  if (headerRowIndex === -1) {
    throw new Error(`Could not locate the header row (${headerMatch.join(" | ")}) in ${dest.tab}.`);
  }

  const dataRows = rows
    .slice(headerRowIndex + 1)
    .filter((r) => r.some((c) => (c ?? "").trim() !== ""));

  return { headerRowIndex, dataRows };
}

/** Insert a row directly below the header (newest-first). */
export async function insertRowBelowHeader(
  token: string,
  dest: Destination,
  headerRowIndex: number,
  row: string[],
): Promise<void> {
  const gridIndex = headerRowIndex + 1; // 0-based position for the new row

  await sheetsFetch(token, `/${dest.spreadsheetId}:batchUpdate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          insertDimension: {
            range: {
              sheetId: dest.gid,
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
  const range = `${dest.tab}!A${rowNumber}:${colLetter(row.length - 1)}${rowNumber}`;
  await sheetsFetch(
    token,
    `/${dest.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: [row] }),
    },
  );
}

/** Duplicate key built from the given column indices. */
export function rowKey(row: string[], dedupColumns: number[]): string {
  return dedupColumns.map((i) => (row[i] ?? "").trim().toLowerCase()).join("|");
}

export function isDuplicate(existing: string[][], row: string[], dedupColumns: number[]): boolean {
  const key = rowKey(row, dedupColumns);
  return existing.some((r) => rowKey(r, dedupColumns) === key);
}
