import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
const built = await build({
  stdin: { contents: 'export * from "./src/google/gmail"; export * from "./src/google/sheets"; export * from "./src/google/retry"; export * from "./src/rules"; export { default as worker } from "./src/index";', resolveDir: process.cwd() },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'unpdf', setup(b) { b.onResolve({ filter: /^unpdf$/ }, () => ({ path: `file://${process.cwd()}/node_modules/unpdf/dist/index.mjs`, external: true })); } }],
});
const app = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`);
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
async function withFetch(fake, run) { const original = globalThis.fetch; globalThis.fetch = fake; try { await run(); } finally { globalThis.fetch = original; } }

test('Gmail follows all result pages before processing emails', async () => {
  const calls = [];
  await withFetch(async url => { const parsed = new URL(url); calls.push(parsed); return parsed.searchParams.has('pageToken') ? json({ messages: [{ id: 'second' }] }) : json({ messages: [{ id: 'first' }], nextPageToken: 'next-page' }); }, async () => {
    assert.deepEqual((await app.listMessages('token', 'investment query')).map(x => x.id), ['first', 'second']);
    assert.equal(calls[1].searchParams.get('pageToken'), 'next-page');
    assert.equal(calls[1].searchParams.get('q'), 'investment query');
  });
});

test('failed emails remain eligible regardless of age', () => {
  assert.doesNotMatch(app.buildQuery('PR-Processed'), /newer_than:|after:/);
  assert.match(app.buildQuery('PR-Processed'), /-label:PR-Processed/);
});

test('temporary Google read failures are retried', async () => {
  let calls = 0;
  await withFetch(async () => ++calls < 3 ? json({}, 503, { 'retry-after': '0' }) : json({ ok: true }), async () => {
    assert.equal((await app.googleFetch('https://google.example/read')).status, 200);
    assert.equal(calls, 3);
  });
});

test('nonrepeatable writes are not blindly retried', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return json({}, 503); }, async () => {
    assert.equal((await app.googleFetch('https://google.example/write', { method: 'POST' })).status, 503);
    assert.equal(calls, 1);
  });
});

test('permanent Google failures are not retried', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return json({}, 403); }, async () => {
    assert.equal((await app.googleFetch('https://google.example/read')).status, 403);
    assert.equal(calls, 1);
  });
});

for (const mode of ['RAW', 'USER_ENTERED']) {
  test(`insertion and ${mode} row data are sent atomically`, async () => {
    const calls = [];
    await withFetch(async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return json({}); }, async () => {
      await app.insertRowBelowHeader('token', { spreadsheetId: 'sheet', gid: 0, tab: 'Sheet1' }, 2, ['06-10-2026', 'Demo', '2', 'Limit', '$89.20', 'Buy'], mode);
      assert.equal(calls.length, 1);
      const requests = calls[0].body.requests;
      assert.equal(requests.length, 2);
      assert.equal(requests[0].insertDimension.range.startIndex, 3);
      assert.equal(mode === 'RAW' ? requests[1].updateCells.start.rowIndex : requests[1].pasteData.coordinate.rowIndex, 3);
      if (mode === 'RAW') assert.equal(requests[1].updateCells.rows[0].values[4].userEnteredValue.stringValue, '$89.20');
      else assert.equal(requests[1].pasteData.data.split('\t')[4], '$89.20');
    });
  });
}

test('duplicate detection tolerates numeric display differences without merging different orders', () => {
  assert.equal(app.isDuplicate([['same', '41.14', '$40.30']], ['same', '41.140', '$40.3'], [0, 1, 2]), true);
  assert.equal(app.isDuplicate([['same', '41.14', '$40.30']], ['same', '41.140', '$39.78'], [0, 1, 2]), false);
});

const sample = {
  subject: 'BUY order of Demo Corp. for $90 is successful',
  body: 'Ticker: Demo Corp. Amount: $90 Price: $44.6 Shares: 2 Order Type: Limit Explore US Stock',
};
const expected = ['06-10-2026', 'Demo Corp.', '2', 'Limit', '$89.20', 'Buy'];
function harness({ failInsert = false, failLabel = false, body = sample.body, failList = false } = {}) {
  const events = [], sheetRows = [], kv = new Map();
  const env = { GMAIL_CLIENT_ID: 'client', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh', GMAIL_LABEL: 'PR-Processed', SYNC_STATE: { put: async (key, value) => kv.set(key, value), get: async (key, type) => type === 'json' ? JSON.parse(kv.get(key) ?? 'null') : kv.get(key) ?? null } };
  const fake = async (url, init) => {
    const path = new URL(url).pathname;
    if (path === '/token') return json({ access_token: 'token' });
    if (path.endsWith('/messages')) return failList ? json({ error: 'forbidden' }, 403) : json({ messages: [{ id: 'order' }] });
    if (path.endsWith('/labels')) return json({ labels: [{ id: 'label', name: 'PR-Processed' }] });
    if (path.endsWith('/messages/order')) return json({ id: 'order', payload: { mimeType: 'text/plain', headers: [{ name: 'Subject', value: sample.subject }, { name: 'From', value: 'transactions@transactions.indmoney.com' }, { name: 'Date', value: 'Tue, 6 Oct 2026 15:30:34 +0000' }], body: { data: Buffer.from(body).toString('base64url') } } });
    if (path.includes('/values/')) return json({ values: [['Date', 'Stock Name', 'Quantity', 'Order Type', 'Requested Price', 'Status'], ...sheetRows] });
    if (path.endsWith(':batchUpdate')) { events.push('insert'); if (failInsert) return json({ error: 'sheet denied' }, 403); const requests = JSON.parse(init.body).requests; sheetRows.push(requests[1].updateCells.rows[0].values.map(c => c.userEnteredValue.stringValue)); return json({}); }
    if (path.endsWith('/modify')) { events.push('label'); return failLabel ? json({ error: 'label denied' }, 403) : json({}); }
    throw new Error(`Unexpected path ${path}`);
  };
  const sync = () => app.worker.fetch(new Request('https://worker.example/api/sync', { method: 'POST' }), env);
  return { env, fake, sync, events, sheetRows, kv };
}

test('successful sync writes calculated totals before labeling and records health status', async () => {
  const h = harness();
  await withFetch(h.fake, async () => {
    const res = await h.sync(); assert.equal(res.status, 200);
    const result = await res.json(); assert.deepEqual(result.processed[0].rows, [expected]);
    assert.deepEqual(h.events, ['insert', 'label']);
    const health = await app.worker.fetch(new Request('https://worker.example/healthz'), h.env);
    assert.equal((await health.json()).lastSync.ok, true);
  });
});

test('failed sheet writes never label an email and return failure status', async () => {
  const h = harness({ failInsert: true });
  await withFetch(h.fake, async () => { const res = await h.sync(); assert.equal(res.status, 500); assert.equal((await res.json()).errors.length, 1); assert.deepEqual(h.events, ['insert']); assert.equal(JSON.parse(h.kv.get('lastSync')).ok, false); });
});

test('incomplete parsing never writes or labels the email', async () => {
  const h = harness({ body: 'Price: $44.6' });
  await withFetch(h.fake, async () => { const res = await h.sync(); assert.equal(res.status, 500); assert.equal((await res.json()).errors.length, 1); assert.deepEqual(h.events, []); });
});

test('a label failure retries without reinserting the successfully written row', async () => {
  const h = harness({ failLabel: true });
  await withFetch(h.fake, async () => {
    assert.equal((await h.sync()).status, 500);
    assert.equal((await h.sync()).status, 500);
    assert.deepEqual(h.sheetRows, [expected]);
    assert.deepEqual(h.events, ['insert', 'label', 'label']);
  });
});

test('Gmail listing failures become structured sync errors', async () => {
  const h = harness({ failList: true });
  await withFetch(h.fake, async () => { const res = await h.sync(); assert.equal(res.status, 500); assert.match((await res.json()).error, /Sync failed:/); assert.deepEqual(h.events, []); });
});

test('health reports a failed sync rather than a healthy service', async () => {
  const h = harness({ failInsert: true });
  await withFetch(h.fake, async () => {
    await h.sync();
    const res = await app.worker.fetch(new Request('https://worker.example/healthz'), h.env);
    assert.equal(res.status, 503);
    const status = await res.json();
    assert.equal(status.ok, false);
    assert.equal(status.lastSync.errors, 1);
  });
});

test('scheduled sync executes the same pipeline and respects the interval gate', async () => {
  const h = harness();
  h.env.SYNC_INTERVAL_MINUTES = '5';
  await withFetch(h.fake, async () => {
    let completion;
    const ctx = { waitUntil(promise) { completion = promise; } };
    await app.worker.scheduled({}, h.env, ctx);
    await completion;
    assert.deepEqual(h.events, ['insert', 'label']);
    assert.equal(JSON.parse(h.kv.get('lastSync')).ok, true);
    await app.worker.scheduled({}, h.env, ctx);
    await completion;
    assert.deepEqual(h.events, ['insert', 'label']);
  });
});
