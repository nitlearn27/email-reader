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

test("uses the body Price and the original order date", () => {
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

test("rejects an incomplete order", () => {
  assert.equal(parseIndmoneyGlobalOrder(body.replace("Price:", "Paid:"), "BUY order of IonQ Inc. for $39.91 is successful", ""), null);
  assert.equal(parseIndmoneyGlobalOrder(body, "BUY order of IonQ Inc. for $39.91 is pending", ""), null);
});
