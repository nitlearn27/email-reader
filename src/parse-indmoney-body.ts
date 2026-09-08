import { formatAmount, toDDMMYYYY } from "./format";
import schemeMap from "./scheme-map.json";

/**
 * Extracts an allotted mutual-fund purchase from an INDmoney confirmation email.
 * Returns a row aligned to: ["Order Date", "Scheme Name", "Amount", "Units", "NAV"].
 */
export function parseIndmoneyBody(text: string): string[][] | null {
  const flat = text.replace(/\s+/g, " ").trim();

  const schemeRaw = flat.match(/\bFund\s*:\s*(.+?)\s+Folio Number\b/i)?.[1]?.trim();
  const amountRaw = flat.match(
    /\bBuy Amount\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)/i,
  )?.[1];
  // INDmoney currently spells this label "alloted" in the details block, while
  // using the correct "allotted" spelling elsewhere in the same email.
  const unitsRaw = flat.match(/\bUnits allo(?:t|tt)ed\s*:?\s*([\d,]+(?:\.\d+)?)/i)?.[1];
  const navRaw = flat.match(/\bAllotted NAV\s*:?\s*([\d,]+(?:\.\d+)?)/i)?.[1];
  const dateRaw = flat.match(/\bOrder date\s*:?\s*(\d{1,2}\s+[A-Za-z]{3,}\s+\d{4})/i)?.[1];

  if (!schemeRaw || !amountRaw || !unitsRaw || !navRaw || !dateRaw) return null;

  const amount = toNumber(amountRaw);
  const units = toNumber(unitsRaw);
  const nav = toNumber(navRaw);
  const date = toDDMMYYYY(dateRaw);
  if (amount == null || units == null || nav == null || !date) return null;

  return [[
    date,
    normalizeScheme(schemeRaw),
    formatAmount(amount),
    String(round2(units)),
    String(nav),
  ]];
}

function normalizeScheme(raw: string): string {
  const lower = raw.toLowerCase();
  for (const [needle, sheetName] of Object.entries(schemeMap as Record<string, string>)) {
    if (!needle.startsWith("_") && lower.includes(needle)) return sheetName;
  }
  return raw;
}

function toNumber(raw: string): number | null {
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
