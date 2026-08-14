const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Normalise a date string to DD-MM-YYYY (the sheet's format).
 * Accepts: "08 Jun 2026", "08-06-2026", "08/06/2026", "2026-06-08", "Jun 08, 2026".
 */
export function toDDMMYYYY(input: string): string | null {
  const s = input.trim();

  // 08 Jun 2026  /  Jun 08, 2026
  let m = s.match(/(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})/);
  if (m) return `${pad(m[1])}-${month(m[2])}-${m[3]}`;
  m = s.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) return `${pad(m[2])}-${month(m[1])}-${m[3]}`;

  // 2026-06-08
  m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${pad(m[3])}-${pad(m[2])}-${m[1]}`;

  // 08-06-2026 / 08/06/2026
  m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${pad(m[1])}-${pad(m[2])}-${m[3]}`;

  return null;
}

/** Normalise a date string to the "8 Jun '26" style used by the Groww sheets. */
export function toSheetDateShort(input: string): string | null {
  const s = input.trim().replace(/,/g, "");

  // 8 Jun 2026 / 8-Jun-2026 / 8/Jun/26
  let m = s.match(/(\d{1,2})[\s\-/]([A-Za-z]{3,})\.?[\s\-/](\d{2,4})/);
  if (m) return `${Number(m[1])} ${monthName(m[2])} '${m[3].slice(-2)}`;

  // Jun 8 2026
  m = s.match(/([A-Za-z]{3,})\.?[\s\-/](\d{1,2})[\s\-/](\d{2,4})/);
  if (m) return `${Number(m[2])} ${monthName(m[1])} '${m[3].slice(-2)}`;

  // 08-06-2026 / 08/06/26 (day first, as Indian statements use)
  m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) {
    const mi = Number(m[2]) - 1;
    if (mi < 0 || mi > 11) return null;
    return `${Number(m[1])} ${MONTH_NAMES[mi]} '${m[3].slice(-2)}`;
  }

  return null;
}

/** Rupee amount in Indian grouping, e.g. "₹25,000" / "₹1,234.50". */
export function formatRupee(value: number): string {
  return Number.isInteger(value)
    ? `₹${value.toLocaleString("en-IN")}`
    : `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format a rupee amount to match the sheet's "₹20K" shorthand for round thousands. */
export function formatAmount(value: number): string {
  if (value >= 1000 && value % 1000 === 0) return `₹${value / 1000}K`;
  return `₹${value.toLocaleString("en-IN")}`;
}

function pad(n: string): string {
  return n.padStart(2, "0");
}

function month(name: string): string {
  return MONTHS[name.slice(0, 3).toLowerCase()] ?? "00";
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthName(name: string): string {
  const i = Number(MONTHS[name.slice(0, 3).toLowerCase()] ?? "0") - 1;
  return MONTH_NAMES[i] ?? name.slice(0, 3);
}
