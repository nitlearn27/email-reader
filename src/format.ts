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
