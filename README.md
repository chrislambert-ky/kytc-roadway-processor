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
| 2 | **Transform** | Pick which KYTC LRS attributes to append from a searchable catalog of 80+ fields. Nine defaults are pre-selected; optional fields can be toggled freely. |
| 3 | **Process / Review** | Sends coordinate batches asynchronously to the KYTC Spatial API and streams results into a live review table as each wave completes. |
| 4 | **Extract** | Download the enriched dataset as **CSV, JSON, GeoJSON, KML, Parquet, GeoParquet, or Excel (XLSX)**. Choose which columns to include and preview 10 rows before downloading. |

**Additional capabilities:**
- Column selector chip cloud — toggle any source column in or out of the load preview table
- Header normalization — column names are automatically uppercased with spaces replaced by `_`
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

**Prerequisites:** [Node.js](https://nodejs.org/) (any recent LTS version).

```bash
# Clone the repository
git clone https://github.com/your-org/kytc-roadway-processor.git
cd kytc-roadway-processor

# Start the development server (no dependencies to install)
node server.js
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000) in your browser.

The server port defaults to `3000` and can be overridden with the `PORT` environment variable:

```bash
PORT=8080 node server.js
```

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

The full attribute catalog is stored in [`kytc_route_api_keys.csv`](kytc_route_api_keys.csv) (80+ fields). The nine attributes selected by default are:

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

All other catalog fields are available as optional selections in Step 2.

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
- **Interactive docs:** [https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/docs](https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/docs)
- **API explorer:** [https://kytc-api-v100-docs-qrntk7e3ra-uc.a.run.app/app](https://kytc-api-v100-docs-qrntk7e3ra-uc.a.run.app/app)

Processing uses async batch requests (`Promise.all`) in waves of 500 rows.

---

## Project Structure

```
kytc-roadway-processor/
├── index.html              # Single-page application shell
├── workflow-app.js         # ES module — all app logic
├── styles.css              # Custom styles (Bootstrap overrides + app-specific)
├── server.js               # Minimal Node.js static file server
├── kytc_route_api_keys.csv # KYTC attribute catalog (key, alias, description)
├── sample-points.csv       # Three-row sample coordinate file
└── package.json            # Project metadata; no runtime dependencies
```

---

## License

This project is provided for use by and in support of the Kentucky Transportation Cabinet. See repository settings for license details.

