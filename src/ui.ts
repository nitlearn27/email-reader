export const UI_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>MF Transaction Sync</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    margin: 0; padding: 2.5rem 1rem; background: #0f1115; color: #e7e9ee;
    display: flex; justify-content: center;
  }
  main { width: 100%; max-width: 720px; }
  h1 { font-size: 1.35rem; margin: 0 0 .25rem; letter-spacing: -.01em; }
  p.sub { margin: 0 0 2rem; color: #9aa0ac; }
  section {
    background: #161922; border: 1px solid #232838; border-radius: 14px;
    padding: 1.25rem 1.35rem; margin-bottom: 1.25rem;
  }
  h2 { font-size: 1rem; margin: 0 0 1rem; display: flex; align-items: center; gap: .5rem; }
  .tag { font-size: .7rem; font-weight: 600; padding: .15rem .5rem; border-radius: 999px;
         background: #232838; color: #9aa0ac; }
  label { display: block; font-size: .8rem; color: #9aa0ac; margin: .75rem 0 .3rem; }
  input[type=file], input[type=password] {
    width: 100%; padding: .55rem .65rem; border-radius: 9px;
    border: 1px solid #2a3042; background: #0f1115; color: #e7e9ee;
  }
  button {
    margin-top: 1rem; padding: .6rem 1.1rem; border: 0; border-radius: 9px;
    font-weight: 600; cursor: pointer; background: #4f7cff; color: #fff;
  }
  button:disabled { opacity: .55; cursor: progress; }
  pre {
    margin-top: 1rem; background: #0b0d12; border: 1px solid #232838; border-radius: 10px;
    padding: .9rem; overflow: auto; max-height: 360px; font-size: .82rem;
    white-space: pre-wrap; word-break: break-word;
  }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem 1rem; margin-top: 1rem; }
  .fields div { font-size: .85rem; }
  .fields span { color: #9aa0ac; }
</style>
</head>
<body>
<main>
  <h1>MF Transaction Sync</h1>
  <p class="sub">Reads "Purchase Request Processed" emails → decrypts the PDF → updates the sheet.</p>

  <section>
    <h2>Run sync <span class="tag">Gmail → Sheet</span></h2>
    <p style="color:#9aa0ac;margin:.25rem 0 0">Processes all new matching emails and inserts rows at the top of the sheet.</p>
    <button id="syncBtn">Run sync now</button>
    <pre id="syncOut" hidden></pre>
  </section>

  <section>
    <h2>Test extraction <span class="tag">PDF only</span></h2>
    <p style="color:#9aa0ac;margin:.25rem 0 0">Upload a sample encrypted PDF to verify the fields parse correctly. Nothing is written.</p>
    <label for="file">Encrypted PDF</label>
    <input type="file" id="file" accept="application/pdf" />
    <label for="pwd">Password (optional — falls back to server config)</label>
    <input type="password" id="pwd" placeholder="PDF password" />
    <button id="extractBtn">Extract fields</button>
    <div class="fields" id="fields" hidden></div>
    <pre id="extractOut" hidden></pre>
  </section>
</main>

<script>
const $ = (id) => document.getElementById(id);

$("syncBtn").onclick = async () => {
  const btn = $("syncBtn"), out = $("syncOut");
  btn.disabled = true; out.hidden = false; out.textContent = "Running…";
  try {
    const res = await fetch("/api/sync", { method: "POST" });
    out.textContent = JSON.stringify(await res.json(), null, 2);
  } catch (e) { out.textContent = String(e); }
  btn.disabled = false;
};

$("extractBtn").onclick = async () => {
  const btn = $("extractBtn"), out = $("extractOut"), fields = $("fields");
  const f = $("file").files[0];
  if (!f) { out.hidden = false; out.textContent = "Choose a PDF first."; return; }
  btn.disabled = true; out.hidden = false; fields.hidden = true; out.textContent = "Extracting…";
  try {
    const fd = new FormData();
    fd.append("file", f);
    if ($("pwd").value) fd.append("password", $("pwd").value);
    const res = await fetch("/api/extract", { method: "POST", body: fd });
    const data = await res.json();
    if (data.parsed) {
      const p = data.parsed;
      fields.hidden = false;
      fields.innerHTML = [
        ["Scheme Name", p.scheme], ["Order Date", p.date],
        ["Amount", p.amount], ["Units", p.units], ["NAV", p.nav],
      ].map(([k, v]) => '<div><span>' + k + ':</span> ' + (v ?? '—') + '</div>').join("");
    }
    out.textContent = JSON.stringify(data, null, 2);
  } catch (e) { out.textContent = String(e); }
  btn.disabled = false;
};
</script>
</body>
</html>`;
