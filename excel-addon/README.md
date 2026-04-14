# KYTC Roadway Processor — Excel Add-in

> [!NOTE]
> **This add-in is in early release.** Core functionality works but some features may be incomplete or change. If you run into issues, use the [web app](https://chrislambert-ky.github.io/kytc-roadway-processor/) instead.

---

## What this does

The Excel add-in lets you enrich a spreadsheet containing GPS coordinates with KYTC Linear Referencing System (LRS) roadway attributes — directly inside Excel Online or Excel Desktop.

**Features:**
- Task pane UI to batch-process rows (select lat/lon columns, snap distance, which fields to write)
- Custom worksheet functions: `=KYTC.LRS()` and `=KYTC.LRS_MULTI()` for cell-level lookups
- `=KYTC.FIELDS()` to list all available attributes and their coverage tiers
- Matches the functionality of the [Google Sheets add-on](../sheets-addon/README.md)

---

## Installation

The add-in is sideloaded via its `manifest.xml` file. There are three ways to install it permanently, depending on your Microsoft 365 setup.

### Option 1 — M365 Admin Center (recommended)

Works in both **Excel Online and Excel Desktop**. Requires Microsoft 365 admin rights.

1. Go to [admin.microsoft.com](https://admin.microsoft.com)
2. **Settings → Integrated apps → Upload custom apps**
3. Choose **"Upload manifest file (.xml)"** and upload [`manifest.xml`](manifest.xml)
4. Assign to yourself or your organization
5. The add-in appears under **Insert → Add-ins → Admin Managed** — no further steps needed

### Option 2 — SharePoint App Catalog

For organizations using SharePoint.

1. Go to your SharePoint admin center → **More features → Apps → App Catalog**
2. Upload `manifest.xml` to the **Apps for Office** library
3. The add-in becomes available to everyone in the org automatically

### Option 3 — Desktop Excel trusted folder (local machine only)

Works only on your own Windows machine in Excel Desktop.

1. Copy `manifest.xml` to any local or network folder
2. In Excel: **File → Options → Trust Center → Trust Center Settings → Trusted Add-in Catalogs**
3. Add the folder path → check **"Show in Menu"** → click OK
4. Restart Excel
5. **Insert → My Add-ins → Shared Folder** → select KYTC Roadway Processor

---

## Architecture note — Cloudflare Worker proxy

Excel Online enforces a strict **Content Security Policy (CSP)** on all task pane iframes. It maintains an allowlist of domains that JavaScript inside the task pane is permitted to call with `fetch()`. The KYTC Spatial API domain (`kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app`) is not on that allowlist, so every direct API call was blocked with a CSP violation error.

Since GitHub Pages is static (no server-side code), the solution was a **Cloudflare Worker** acting as a thin proxy:

```
Excel task pane → https://kytc-proxy.kypc.workers.dev → KYTC Spatial API
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
