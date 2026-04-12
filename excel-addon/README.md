# KYTC Roadway Processor — Excel Add-in

> [!WARNING]
> **This add-in is not yet ready for use.** It is under active development and may not function correctly. Check back later or use the [Google Sheets add-on](../sheets-addon/README.md) or [web app](https://chrislambert-ky.github.io/kytc-roadway-processor/) instead.

---

## What this will do

When complete, the Excel add-in will let you enrich a spreadsheet containing GPS coordinates with KYTC Linear Referencing System (LRS) roadway attributes — directly inside Excel Online or Excel Desktop.

**Planned features:**
- Task pane UI to batch-process rows (select lat/lon columns, snap distance, which fields to write)
- Custom worksheet functions: `=KYTC.LRS()` and `=KYTC.LRS_MULTI()` for cell-level lookups
- `=KYTC.FIELDS()` to list all available attributes and their coverage tiers
- Matches the functionality of the [Google Sheets add-on](../sheets-addon/README.md)

---

## Known blockers

- **Content Security Policy (CSP)** — Excel Online blocks direct `fetch()` calls to external APIs. A proxy is being set up to route requests through an allowed domain.

---

## Alternatives (available now)

| Tool | Link |
|------|------|
| Web app (no install) | [chrislambert-ky.github.io/kytc-roadway-processor](https://chrislambert-ky.github.io/kytc-roadway-processor/) |
| Google Sheets add-on | See [sheets-addon/README.md](../sheets-addon/README.md) |
