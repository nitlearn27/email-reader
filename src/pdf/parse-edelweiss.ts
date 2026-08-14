import { formatAmount, toDDMMYYYY } from "../format";
import schemeMap from "../scheme-map.json";

export interface ParsedEdelweissTransaction {
  scheme: string | null;
  date: string | null; // DD-MM-YYYY
  amount: string | null; // formatted "₹30K"
  units: number | null; // units allotted, rounded to 2dp to match the sheet
  nav: number | null;
}

/**
 * Extract the latest purchase from a KFintech / Edelweiss account statement
 * ("Last Five Transactions"), which flattens to one line per pdf.js as:
 *   `<Tr.Date> <NavDate> Net Purchase <amount> <nav> <load> <price> <units> <balUnits>`
 * with the pre-stamp-duty amount on a separate `<Tr.Date> <NavDate> Gross Purchase <amount>`.
 * We take the most recent purchase, prefer its gross amount, and resolve the scheme from
 * the nearest preceding `Scheme : … - ISIN :` header (statements can list several).
 */
export function parseEdelweissStatement(text: string): ParsedEdelweissTransaction {
  const flat = text.replace(/\s+/g, " ").trim();

  const netRe =
    /(\d{2}\/\d{2}\/\d{4})\s+\d{2}\/\d{2}\/\d{4}\s+Net\s+(?:[A-Za-z]+\s+)?Purchase\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{4})\s+[\d,]+\.\d{4}\s+[\d,]+\.\d{4}\s+([\d,]+\.\d{3})/g;
  const purchases: { date: string; netAmount: number; nav: number; units: number; at: number; ts: number }[] = [];
  for (const m of flat.matchAll(netRe)) {
    purchases.push({
      date: m[1],
      netAmount: num(m[2]),
      nav: num(m[3]),
      units: num(m[4]),
      at: m.index ?? 0,
      ts: dmyToTs(m[1]),
    });
  }
  if (purchases.length === 0) {
    return { scheme: null, date: null, amount: null, units: null, nav: null };
  }

  const grossRe =
    /(\d{2}\/\d{2}\/\d{4})\s+\d{2}\/\d{2}\/\d{4}\s+Gross\s+(?:[A-Za-z]+\s+)?Purchase\s+([\d,]+\.\d{2})/g;
  const grossByDate = new Map<string, number>();
  for (const m of flat.matchAll(grossRe)) grossByDate.set(m[1], num(m[2]));

  const schemeHeaders: { at: number; name: string }[] = [];
  for (const m of flat.matchAll(/Scheme\s*:\s*(.+?)\s*-?\s*ISIN\s*:/g)) {
    schemeHeaders.push({ at: m.index ?? 0, name: m[1] });
  }

  const latest = purchases.reduce((a, b) => (b.ts >= a.ts ? b : a));
  const header = schemeHeaders.filter((h) => h.at < latest.at).pop();

  return {
    scheme: mapScheme(header?.name ?? flat),
    date: toDDMMYYYY(latest.date),
    amount: formatAmount(grossByDate.get(latest.date) ?? latest.netAmount),
    units: round2(latest.units),
    nav: latest.nav,
  };
}

/** Map the statement's scheme name to the sheet's convention (src/scheme-map.json). */
function mapScheme(raw: string): string | null {
  const lower = raw.toLowerCase();
  for (const [needle, sheetName] of Object.entries(schemeMap as Record<string, string>)) {
    if (needle.startsWith("_")) continue;
    if (lower.includes(needle)) return sheetName;
  }
  return null;
}

function num(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dmyToTs(dmy: string): number {
  const [d, m, y] = dmy.split("/").map(Number);
  return Date.UTC(y, m - 1, d);
}
