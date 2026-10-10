import { toDDMMYYYY } from "./format";

/** A successful INDmoney US-stock order, aligned to the Global Stocks sheet. */
export function parseIndmoneyGlobalOrder(
  text: string,
  subject: string,
  messageDate: string,
): string[][] | null {
  const match = subject.trim().match(
    /^(?:fwd:\s*)*(BUY|SELL) order of (.+?) for \$[\d,.]+ is successful$/i,
  );
  if (!match) return null;

  const dateText = text.match(/^Date:\s*(?:[A-Za-z]{3},?\s+)?([A-Za-z]{3,}\s+\d{1,2},?\s+\d{4})/im)?.[1]
    ?? messageDate;
  const date = toDDMMYYYY(dateText);
  // HTML-only emails become one line after tag stripping; forwarded plain text
  // keeps line breaks. Read field labels in either representation.
  const price = text.match(/\bPrice:\s*\$([\d,]+(?:\.\d+)?)/i)?.[1];
  const shares = text.match(/\bShares:\s*([\d,]+(?:\.\d+)?)/i)?.[1];
  const orderType = text.match(
    /\bOrder Type:\s*([^\r\n]+?)(?=\s+(?:Explore US Stock|US a\/c no\.|Get the INDmoney app!)|[\r\n]|$)/i,
  )?.[1]?.trim();
  if (!date || !price || !shares || !orderType) return null;

  return [[
    date,
    match[2].trim(),
    shares.replace(/,/g, ""),
    orderType,
    totalRequestedPrice(price, shares),
    match[1].toLowerCase() === "buy" ? "Buy" : "Sell",
  ]];
}

/** Multiply decimal strings exactly, then round the dollar total to cents. */
function totalRequestedPrice(price: string, shares: string): string {
  const decimals = [price, shares].map((value) => {
    const [whole, fraction = ""] = value.replace(/,/g, "").split(".");
    return { units: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) };
  });
  const product = decimals[0].units * decimals[1].units;
  const scale = decimals[0].scale * decimals[1].scale;
  const cents = (product * 100n + scale / 2n) / scale;
  return `$${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
