import { formatAmount, toDDMMYYYY } from "../format";
import schemeMap from "../scheme-map.json";

export interface ParsedTransaction {
  scheme: string | null;
  date: string | null; // DD-MM-YYYY
  amountValue: number | null;
  amount: string | null; // formatted "₹20K"
  units: number | null; // units allotted, rounded to 2dp to match the sheet
  nav: number | null; // purchased NAV (price per unit)
}

/**
 * Extract the latest purchase from an Invesco mutual-fund account statement (CAS).
 *
 * The statement flattens to a single line per pdf.js; a "Net Additional Purchase"
 * row carries `units netAmount nav … Net Additional Purchase <Tr.Date>`, and the
 * gross amount appears separately as `<gross> <navDate> Gross Additional Purchase <Tr.Date>`.
 * We collect all purchases, pick the most recent, and prefer the gross amount.
 * Scheme name is mapped to the user's sheet convention via src/scheme-map.json.
 */
export function parseTransaction(text: string): ParsedTransaction {
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();

  let scheme: string | null = null;
  for (const [needle, sheetName] of Object.entries(schemeMap as Record<string, string>)) {
    if (needle.startsWith("_")) continue;
    if (lower.includes(needle)) {
      scheme = sheetName;
      break;
    }
  }

  // Net purchase rows → units, net amount, nav, transaction date.
  const netRe =
    /([\d,]+\.\d{3})\s+([\d,]+\.\d{2})\s+(\d+\.\d{6})\s+\d+\s+[\d.]+\s+Net Additional Purchase\s+(\d{2}\/\d{2}\/\d{4})/g;
  const purchases: { units: number; netAmount: number; nav: number; date: string; ts: number }[] = [];
  for (const m of flat.matchAll(netRe)) {
    purchases.push({
      units: num(m[1]),
      netAmount: num(m[2]),
      nav: num(m[3]),
      date: m[4],
      ts: dmyToTs(m[4]),
    });
  }

  // Gross amounts keyed by transaction date.
  const grossRe =
    /([\d,]+\.\d{2})\s+\d{2}\/\d{2}\/\d{4}\s+Gross Additional Purchase\s+(\d{2}\/\d{2}\/\d{4})/g;
  const grossByDate = new Map<string, number>();
  for (const m of flat.matchAll(grossRe)) grossByDate.set(m[2], num(m[1]));

  if (purchases.length === 0) {
    return { scheme, date: null, amountValue: null, amount: null, units: null, nav: null };
  }

  const latest = purchases.reduce((a, b) => (b.ts > a.ts ? b : a));
  const amountValue = grossByDate.get(latest.date) ?? latest.netAmount;

  return {
    scheme,
    date: toDDMMYYYY(latest.date),
    amountValue,
    amount: formatAmount(amountValue),
    units: round2(latest.units),
    nav: latest.nav,
  };
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
