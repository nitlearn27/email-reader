import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/rules.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { buildQuery, matchRule } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}`
);

test("stock-order query excludes sent copies", () => {
  const query = buildQuery("PR-Processed");
  assert.match(query, /-in:sent/);
  assert.match(query, /"is successful"/);
});

test("only successful original-sender stock orders match", () => {
  const source = "From: Transactions INDmoney <transactions@transactions.indmoney.com>";
  const successful = "Fwd: BUY order of IonQ Inc. for $39.91 is successful";
  assert.equal(matchRule(successful, `${successful} ${source}`.toLowerCase())?.parser, "indmoney-global-order");
  const cancelled = "Fwd: Buy order of IonQ Inc. is cancelled";
  assert.equal(matchRule(cancelled, `${cancelled} ${source}`.toLowerCase()), null);
  assert.equal(matchRule(successful, successful.toLowerCase()), null);
});
