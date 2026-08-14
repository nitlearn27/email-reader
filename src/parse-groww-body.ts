import { formatRupee, toSheetDateShort } from "./format";

/**
 * The only scheme this parser accepts. Groww reuses the "One-time investment:
 * Units allocated" subject for every fund, so anything else is rejected (null)
 * and the email is left untouched.
 */
const SCHEME_KEY = "quant small cap";
const SCHEME_NAME = "Quant Small Cap Fund Direct Plan Growth";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The body carries no transaction date, only the order id (e.g. GLMP2608121049529988)
 * whose first six digits are the order date YYMMDD.
 */
function dateFromOrderId(orderId: string): string | null {
  const m = orderId.match(/^[A-Z]+(\d{2})(\d{2})(\d{2})/i);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${day} ${MONTHS[month - 1]} '${m[1]}`;
}

/**
 * Extracts a Groww one-time investment allotment from the email body.
 * Returns a row aligned to: ["Date", "Mutual Fund Name", "Amount", "Type", "Units", "Status"].
 */
export function parseGrowwBody(text: string): string[][] | null {
  const flat = text.replace(/\s+/g, " ").trim();

  const scheme = flat.match(/SCHEME NAME\s+(.*?)\s+INVESTMENT AMOUNT/i)?.[1]?.trim();
  if (!scheme || !scheme.toLowerCase().includes(SCHEME_KEY)) return null;

  const amountRaw = flat.match(/INVESTMENT AMOUNT\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)/i)?.[1];
  if (!amountRaw) return null;
  const amountVal = parseFloat(amountRaw.replace(/,/g, ""));
  if (isNaN(amountVal)) return null;

  const units = flat.match(/UNITS ALLOCATED\s*([\d,]+(?:\.\d+)?)/i)?.[1]?.replace(/,/g, "");
  if (!units) return null;

  const orderId = flat.match(/ORDER ID\s*([A-Z]+\d+)/i)?.[1];
  // Fall back to the forwarded original's "Date:" line when the id is missing/odd.
  const fwdDate = flat.match(/Date:\s*(?:[A-Za-z]{3},?\s*)?(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/)?.[1];
  const date = (orderId && dateFromOrderId(orderId)) || (fwdDate && toSheetDateShort(fwdDate));
  if (!date) return null;

  return [[date, SCHEME_NAME, formatRupee(amountVal), "Buy", units, "Completed"]];
}
