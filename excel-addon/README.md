# KYTC Roadway Processor — Excel Add-in

> [!NOTE]
> **This add-in is in early release.** If you run into issues, use the [Google Sheets add-on](../sheets-addon/README.md) or [web app](https://chrislambert-ky.github.io/kytc-roadway-processor/) as alternatives.

---

## What this does

The Excel add-in lets you enrich a spreadsheet containing GPS coordinates with KYTC Linear Referencing System (LRS) roadway attributes — directly inside Excel Online or Excel Desktop.

**Features:**
- Task pane UI to batch-process rows (select lat/lon columns, snap distance, which fields to write)
- Custom worksheet functions: `=KYTC.LRS()` and `=KYTC.LRS_MULTI()` for cell-level lookups
- `=KYTC.FIELDS()` to list all available attributes and their coverage tiers
- Matches the functionality of the [Google Sheets add-on](../sheets-addon/README.md)

---

## Architecture note — Cloudflare Worker proxy

Excel Online enforces a strict **Content Security Policy (CSP)** on all task pane iframes. It maintains an allowlist of domains that JavaScript inside the task pane is permitted to call with `fetch()`. The KYTC Spatial API domain (`kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app`) is not on that allowlist, so every direct API call was blocked with a CSP violation error.

Since GitHub Pages is static (no server-side code), the solution was a **Cloudflare Worker** acting as a thin proxy:

```
Excel task pane → https://kytc-proxy.chrslmbrt.workers.dev → KYTC Spatial API
```

The worker ([cf-worker.js](cf-worker.js)):
1. Receives the request from the task pane
2. Forwards all query parameters unchanged to the KYTC API
3. Returns the response with `Access-Control-Allow-Origin: *` headers added

The `*.workers.dev` domain is not explicitly blocked by Excel Online's CSP, so requests go through cleanly. The Cloudflare free tier handles this at no cost.

---

## Alternatives (available now)

| Tool | Link |
|------|------|
| Web app (no install) | [chrislambert-ky.github.io/kytc-roadway-processor](https://chrislambert-ky.github.io/kytc-roadway-processor/) |
| Google Sheets add-on | See [sheets-addon/README.md](../sheets-addon/README.md) |
