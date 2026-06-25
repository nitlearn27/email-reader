const SCHEME_NAME_MAP: Record<string, string> = {
  "invesco india midcap fund - direct plan growth": "Invesco India Mid Cap Fund Direct Growth",
  "invesco india midcap fund - direct plan - growth": "Invesco India Mid Cap Fund Direct Growth",
};

function getSchemeName(rawName: string): string {
  const normalized = rawName.trim().replace(/\s+/g, " ").toLowerCase();
  return SCHEME_NAME_MAP[normalized] ?? rawName.trim();
}

function formatDateToSheetStyle(dateStr: string): string {
  const match = dateStr.match(/(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{4}|\d{2})/);
  if (match) {
    const day = parseInt(match[1], 10).toString();
    let month = match[2];
    const year = match[3];
    
    if (/^\d+$/.test(month)) {
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const mIdx = parseInt(month, 10) - 1;
      month = monthNames[mIdx] || month;
    } else {
      month = month.slice(0, 1).toUpperCase() + month.slice(1, 3).toLowerCase();
    }
    
    const shortYear = year.slice(-2);
    return `${day} ${month} '${shortYear}`;
  }
  return dateStr;
}

function formatRupee(value: number): string {
  if (Number.isInteger(value)) {
    return `₹${value.toLocaleString("en-IN")}`;
  }
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Extracts transaction details from Invesco Mutual Fund purchase request processed body email.
 * Returns array of rows aligned to: ["Date", "Mutual Fund Name", "Amount", "Type", "Units", "Status"]
 */
export function parseInvescoBody(text: string): string[][] | null {
  const flat = text.replace(/\s+/g, " ").trim();

  // Extract Scheme Details
  const schemeMatch = flat.match(/Scheme Details\s+(.*?)\s+(?:ISIN|NAV Date)/i);
  if (!schemeMatch) return null;
  const scheme = getSchemeName(schemeMatch[1]);

  // Extract Date (Trade Date first, fallback to NAV Date)
  let dateRaw: string | null = null;
  const tradeDateMatch = flat.match(/Trade Date\s+(\d{2}-[A-Za-z]{3}-\d{4})/i);
  if (tradeDateMatch) {
    dateRaw = tradeDateMatch[1];
  } else {
    const navDateMatch = flat.match(/NAV Date\s+(\d{2}-[A-Za-z]{3}-\d{4})/i);
    if (navDateMatch) {
      dateRaw = navDateMatch[1];
    }
  }
  if (!dateRaw) return null;
  const date = formatDateToSheetStyle(dateRaw);

  // Extract Units
  const unitsMatch = flat.match(/Units \(Nos\.\) Allotted\s+([\d.]+)/i);
  if (!unitsMatch) return null;
  const units = unitsMatch[1].trim();

  // Extract Amount
  const amountMatch = flat.match(/Amount \(Rs\.\)\s+([\d.]+)/i);
  if (!amountMatch) return null;
  const amountVal = parseFloat(amountMatch[1].replace(/,/g, ""));
  if (isNaN(amountVal)) return null;
  const amount = formatRupee(amountVal);

  const type = "Buy";
  const status = "Completed";

  return [[date, scheme, amount, type, units, status]];
}
