import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const built = await build({
  entryPoints: ["src/parse-indmoney-global-order.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { parseIndmoneyGlobalOrder } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString("base64")}`
);

const body = `---------- Forwarded message ---------
From: Transactions INDmoney <transactions@transactions.indmoney.com>
Date: Tue, Sep 8, 2026 at 11:28 PM
Subject: BUY order of IonQ Inc. for $39.91 is successful

Ticker:
IonQ Inc.
Amount:
$39.91
Price:
$39.78
Shares:
1
Order Type:
Limit`;

test("uses Price times Shares and the original order date", () => {
  assert.deepEqual(
    parseIndmoneyGlobalOrder(body, "Fwd: BUY order of IonQ Inc. for $39.91 is successful", "Fri, 2 Oct 2026 12:24:27 +0530"),
    [["08-09-2026", "IonQ Inc.", "1", "Limit", "$39.78", "Buy"]],
  );
});

test("takes Sell from the subject", () => {
  assert.equal(
    parseIndmoneyGlobalOrder(body, "SELL order of IonQ Inc. for $39.91 is successful", "")?.[0][5],
    "Sell",
  );
});

test("reads HTML-only orders after the body is flattened", () => {
  for (const [stock, amount, price, orderType] of [
    ["IonQ Inc.", "43.64", "43.5", "Limit"],
    ["D-Wave Quantum Inc.", "15.89", "15.83", "Market"],
  ]) {
    const text = `Hi Nitesh, Your BUY order for ${stock} is successful. Ticker: ${stock} Amount: $${amount} Price: $${price} Shares: 1 Order Type: ${orderType} Explore US Stock Get the INDmoney app!`;
    assert.deepEqual(
      parseIndmoneyGlobalOrder(text, `BUY order of ${stock} for $${amount} is successful`, "Tue, 6 Oct 2026 15:30:34 +0000"),
      [["06-10-2026", stock, "1", orderType, `$${Number(price).toFixed(2)}`, "Buy"]],
    );
  }
});

test("does not need Amount or use the subject amount", () => {
  assert.equal(
    parseIndmoneyGlobalOrder(body.replace("Amount:", "Paid:"), "BUY order of IonQ Inc. for $50 is successful", "")?.[0][4],
    "$39.78",
  );
});

test("multiplies whole and fractional shares with exact cent rounding", () => {
  for (const [price, shares, expected] of [
    ["44.6", "2", "$89.20"],
    ["16.7", "3", "$50.10"],
    ["12.34", "0.123456", "$1.52"],
    ["0.15", "0.1", "$0.02"],
    ["1,000.25", "1,000", "$1000250.00"],
  ]) {
    const text = body.replace("$39.78", `$${price}`).replace("Shares:\n1", `Shares:\n${shares}`);
    assert.equal(parseIndmoneyGlobalOrder(text, "BUY order of IonQ Inc. for $50 is successful", "")?.[0][4], expected);
  }
});

test("rejects an incomplete order", () => {
  assert.equal(parseIndmoneyGlobalOrder(body.replace("Price:", "Paid:"), "BUY order of IonQ Inc. for $39.91 is successful", ""), null);
  assert.equal(parseIndmoneyGlobalOrder(body, "BUY order of IonQ Inc. for $39.91 is pending", ""), null);
});
