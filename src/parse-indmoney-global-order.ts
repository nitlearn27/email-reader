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
  const price = text.match(/^Price:\s*\$([\d,]+(?:\.\d+)?)/im)?.[1];
  const shares = text.match(/^Shares:\s*([\d,]+(?:\.\d+)?)/im)?.[1];
  const orderType = text.match(/^Order Type:\s*([^\r\n]+)/im)?.[1]?.trim();
  if (!date || !price || !shares || !orderType) return null;

  return [[
    date,
    match[2].trim(),
    shares.replace(/,/g, ""),
    orderType,
    `$${price.replace(/,/g, "")}`,
    match[1].toLowerCase() === "buy" ? "Buy" : "Sell",
  ]];
}
