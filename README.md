# KYTC Roadway Attribute Processor

A browser-based single-page application for enriching coordinate datasets with Kentucky Transportation Cabinet (KYTC) Linear Referencing System (LRS) roadway attributes. Upload a file with GPS coordinates, choose which roadway attributes to append, process the records against the KYTC Spatial API, and export the enriched dataset in the format of your choice — all without leaving the browser.

---

## Live App

Hosted on GitHub Pages: [https://chrislambert-ky.github.io/kytc-roadway-processor/](https://chrislambert-ky.github.io/kytc-roadway-processor/)

---

## Features

| Step | Name | Description |
|------|------|-------------|
| 1 | **Load Data** | Drag-and-drop or browse for a CSV, JSON, GeoJSON, or Parquet file. Map latitude/longitude columns or choose a WKT Point column. |
| 2 | **Transform** | Pick which KYTC LRS attributes to append from a searchable catalog of 80+ fields loaded live from the API. Nine defaults are pre-selected; any attribute — including the defaults — can be toggled on or off, or reset back to the recommended set at any time. |
| 3 | **Process / Review** | Set a snap distance/tolerance (feet), then send coordinate batches asynchronously to the KYTC Spatial API. Results stream into a live review table as each wave completes. A collapsible request log records each batch in real time. |
| 4 | **Extract** | Download the enriched dataset as **CSV, JSON, GeoJSON, KML, Parquet, GeoParquet, or Excel (XLSX)**. Choose which columns to include and preview 10 rows before downloading. |

**Additional capabilities:**
- Column selector chip cloud — toggle any source column in or out of the load preview table
- Header normalization — column names are automatically uppercased with spaces replaced by `_`
- Snap distance/tolerance control — configurable per run (default 100 ft, range 1–5000 ft); clamped and validated before each API call
- Collapsible real-time request log on Step 3 — auto-expands when processing starts
- In-browser analytics powered by DuckDB-WASM (CSV loading, Parquet/GeoParquet export)
- Status indicators for KYTC API and DuckDB engine readiness
- Google Analytics integration (tag `G-468B94S87K`)

---

## Tech Stack

| Library | Version | Purpose |
|---------|---------|---------|
| [Bootstrap](https://getbootstrap.com/) | 5.3.3 | UI framework |
| [Bootstrap Icons](https://icons.getbootstrap.com/) | 1.11.3 | Icon set |
| [Tabulator](https://tabulator.info/) | 5.5.2 | Interactive data tables |
| [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview.html) | 1.29.0 | In-browser SQL engine (CSV load, Parquet export) |
| IBM Plex Mono | — | Monospace UI font (Google Fonts) |

All libraries are loaded from CDN — no build step or npm install required for the front end.

---

## Getting Started (Local Development)

The app is a static single-page application and can be served by any local HTTP server.

**Prerequisites:** [Node.js](https://nodejs.org/) (any recent LTS version).

```bash
# Clone the repository
git clone https://github.com/chrislambert-ky/kytc-roadway-processor.git
cd kytc-roadway-processor

# Serve with any static file server, e.g. the built-in npx option:
npx serve .
```

Open the URL printed by your server (typically [http://localhost:3000](http://localhost:3000)) in your browser.

> **Note:** DuckDB-WASM requires that files are served over HTTP (not opened as `file://`). Always use the local server during development.

---

## Input File Requirements

### Supported formats

| Format | Notes |
|--------|-------|
| CSV | Loaded via DuckDB-WASM `read_csv_auto` |
| JSON | Array of objects at the top level |
| GeoJSON | `FeatureCollection` or single `Feature`; Point coordinates are extracted automatically |
| Parquet | Loaded via DuckDB-WASM |

### Coordinate input modes

| Mode | Description |
|------|-------------|
| **Separate columns** | Select individual latitude and longitude columns from your file |
| **WKT Point** | A column containing standard `POINT (longitude latitude)` strings |
| **Other Point** | A column containing `POINT (latitude longitude)` strings (reversed axis order) |

Kentucky coordinates: latitude **36.5° – 39.1° N**, longitude **−89.6° to −82.0° W**.

### Sample file

A minimal three-row sample is included at [`sample-points.csv`](sample-points.csv):

```csv
Site_ID,Latitude,Longitude,Comment
1,38.168369,-84.899536,Frankfort sample
2,38.200100,-84.873000,Nearby sample
3,37.839333,-84.270018,Lexington sample
```

---

## KYTC Attribute Catalog

The full attribute catalog is fetched live from the KYTC API each time the app starts:

```
GET https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/utilities/GetReturnKeyInfo?service=GetRouteInfoByCoordinates
```

This means the field list always reflects the current API schema — no static file to maintain. The nine attributes selected by default are:

| Field | Description |
|-------|-------------|
| `District_Number` | Numerical KYTC district designation |
| `County_Name` | County name |
| `Route_Label` | Generalized route label for map production |
| `Road_Name` | Full, unabbreviated road name |
| `Cardinality` | Main direction of travel (Cardinal / Non-Cardinal) |
| `Direction` | Direction of travel (NB, SB, EB, WB, etc.) |
| `Milepoint` | Milepoint to which the source point was aligned |
| `Snap_Distance_Feet` | Distance in feet from source point to snapped centerline |
| `Snap_Probability` | Probability that the snapped alignment is correct |

All other catalog fields are available as optional selections in Step 2. The defaults can also be manually unchecked if needed — the **Defaults** button restores them.

---

## Export Formats

| Format | Engine | Notes |
|--------|--------|-------|
| CSV | Browser | Comma-separated, UTF-8 |
| JSON | Browser | Array of objects |
| GeoJSON | Browser | `FeatureCollection`; requires lat/lon columns |
| KML | Browser | Google Earth / Maps compatible |
| Parquet | DuckDB-WASM | Columnar binary format |
| GeoParquet | DuckDB-WASM | Parquet with spatial metadata |
| Excel (XLSX) | Browser | `.xlsx` workbook |

---

## API Reference

- **Endpoint:** `https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/route/GetRouteInfoByCoordinates`
- **Attribute catalog:** `https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/utilities/GetReturnKeyInfo?service=GetRouteInfoByCoordinates`
- **Interactive docs:** [https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/docs](https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/docs)
- **API explorer:** [https://kytc-api-v100-docs-qrntk7e3ra-uc.a.run.app/app](https://kytc-api-v100-docs-qrntk7e3ra-uc.a.run.app/app)

Processing uses async batch requests (`Promise.all`) in waves of 500 rows. Snap distance defaults to 100 ft and can be adjusted per run in the Step 3 controls — keep it as low as practical for large datasets to preserve performance. For data with outliers, consider two passes: one with a tight snap distance, then a second pass on unmatched rows with a larger value.

---

## Project Structure

```
kytc-roadway-processor/
├── index.html              # Single-page application shell
├── workflow-app.js         # ES module — all app logic
├── styles.css              # Custom styles (Bootstrap overrides + app-specific)
├── package.json            # Project metadata; no runtime dependencies

---

## License

This is an unofficial personal project with no formal license. It is not affiliated with or endorsed by the Kentucky Transportation Cabinet.

The underlying KYTC Spatial API is publicly accessible and provided by the Kentucky Transportation Cabinet. This tool is simply a browser-based interface designed to make that API usable without programming — no data is stored, and no server-side processing is performed beyond the API calls themselves.

---

## Acknowledgements

A special thanks to **Jeremy Gould** for developing and maintaining the official KYTC Spatial API that powers this tool.

- GitHub: [spatialiota](https://github.com/spatialiota)
- LinkedIn: [jeremy-gould-us](https://www.linkedin.com/in/jeremy-gould-us)

