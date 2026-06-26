import { toDDMMYYYY } from "../format";

/** Standardize common stock and ETF names to match the spreadsheet convention. */
export function cleanStockName(name: string): string {
  const cleaned = name.trim();
  const lower = cleaned.toLowerCase();
  
  if (lower.includes("motilal") && lower.includes("nasdaq")) {
    return "Motilal Oswal NASDAQ 100 ETF";
  }
  if (
    lower.includes("uti nifty n") || 
    (lower.includes("uti") && lower.includes("nifty") && lower.includes("next"))
  ) {
    return "UTI Nifty Next 50 ETF";
  }
  if (lower.includes("nippon") && lower.includes("silver")) {
    return "Nippon India Silver ETF";
  }
  if (
    lower.includes("sbi") && 
    lower.includes("nifty") && 
    (lower.includes("50") || lower.includes("etf"))
  ) {
    return "SBI ETF Nifty 50";
  }
  return cleaned;
}

/**
 * Parse an NSE "Trades executed at NSE" contract note (Capital Market section).
 *
 * pdf.js flattens each trade to one line:
 *   <SrNo> <TM Name> <ClientCode> <B|S> <Security Name> <Symbol> <Series>
 *   <TradeNo(17 digits, YYYYMMDD…)> <Time AM/PM> <Qty> <Price> <Traded Value>
 *
 * Returns one row per trade aligned to [Date, Stock Name, Quantity, Order Type,
 * Requested Price, Status]. The date is the trade-no prefix; status is always
 * "Success" (a contract note only lists executed trades). Layout-dependent — tune
 * against the `textPreview` from /api/extract if a field stops matching.
 */
export function parseNseTrades(text: string): string[][] {
  const flat = text.replace(/\s+/g, " ").trim();

  // Anchored on the 17-digit trade no (starts with an 8-digit date) and the
  // numeric qty/price/value tail; security name is non-greedy between B/S and symbol.
  const re =
    /\d{4,}\s+([BS])\s+(.+?)\s+[A-Z0-9]+\s+[A-Z]{1,2}\s+(\d{8})\d{9}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M\s+(\d+(?:\.\d+)?)\s+([\d,]+\.\d+)\s+[\d,]+\.\d+/g;

  const rows: string[][] = [];
  for (const m of flat.matchAll(re)) {
    const [, side, name, ymd, qty, price] = m;
    const date = toDDMMYYYY(`${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`);
    if (!date) continue;
    rows.push([
      date,
      cleanStockName(name),
      String(Number(qty)),
      side === "B" ? "Buy" : "Sell",
      `₹${price}`,
      "Success",
    ]);
  }
  return rows;
}
