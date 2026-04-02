# KYTC Roadway Processor

A browser-based front-end for the [Kentucky Transportation Cabinet Spatial API](https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/docs).

Import GPS coordinate data, enrich it with LRS (Linear Referencing System) roadway attributes from the KYTC Spatial API, and download the results in your preferred format — all entirely in the browser with no server required.

---

## Features

- **DuckDB-WASM** — in-browser SQL data processing; no data is uploaded to any server
- **Flexible data import** — drag & drop or browse for local files, or load from a URL
  - Supported formats: **CSV, TSV, JSON, NDJSON, Parquet, GeoJSON**
- **Auto-detection** of latitude/longitude columns
- **18 KYTC LRS roadway attributes** selectable via checklist, grouped by category:
  - *Location:* County Name, Road Name, Route, Route Type, Route ID, Milepoint, Direction, Cardinality
  - *Classification:* Government Level, Type of Operation
  - *Characteristics:* Speed Limit, Lane Width, Median Type, Median Width, Grade %
  - *Traffic:* AADT Traffic Count, Truck Weight Class
  - *Geometry:* Snapped point geometry (WKT)
- **Async processing** with progress bar, ETA, cancel button, and rolling activity log
- **Export formats:** CSV, JSON, Parquet, GeoJSON, KML, KMZ

---

## How It Works

```
1. Import  →  2. Preview & Configure  →  3. Select Attributes  →  4. Process  →  5. Export
```

1. **Import** — load a CSV/JSON/Parquet/GeoJSON file from disk or a URL
2. **Preview & Configure** — review the data table and select which columns represent latitude and longitude (WGS84 decimal degrees)
3. **Select Attributes** — choose which KYTC LRS roadway attributes to fetch
4. **Process** — each row's coordinates are sent to the KYTC Spatial API; matched attributes are joined back to the table
5. **Export** — download the enriched dataset in CSV, JSON, Parquet, GeoJSON, KML, or KMZ

---

## API

The app calls the KYTC Spatial API endpoint:

```
GET https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/route/GetRouteInfoByCoordinates
```

Key parameters:

| Parameter       | Description                               |
|-----------------|-------------------------------------------|
| `xcoord`        | Longitude (WGS84)                         |
| `ycoord`        | Latitude (WGS84)                          |
| `snap_distance` | Search radius in feet (default: 100)      |
| `return_keys`   | Comma-separated list of attributes        |
| `return_format` | `json`                                    |
| `input_epsg`    | `4326`                                    |
| `output_epsg`   | `4326`                                    |

- [API Documentation (Swagger)](https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/docs)
- [KYTC Data Explorer](https://kytc-api-v100-docs-qrntk7e3ra-uc.a.run.app/app)

---

## Technology

| Library | Version | Purpose |
|---------|---------|---------|
| [@duckdb/duckdb-wasm](https://duckdb.org/docs/stable/clients/wasm/overview) | 1.30.0* | In-browser SQL / data processing |
| [Tailwind CSS](https://tailwindcss.com) | CDN | Styling |
| [JSZip](https://stuk.github.io/jszip/) | 3.10.1 | KMZ file generation |

*Version 1.29.2 was briefly compromised (CVE-2025-59037 / GHSA-w62p-hx95-gf2c); 1.30.0 is the officially patched release per the DuckDB security advisory.

---

## Usage

This is a fully static single-page application. Open `index.html` in any modern browser (or serve it with any static HTTP server):

```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .
```

Then open `http://localhost:8080` in your browser.

> **Note:** The KYTC API returns attributes for roadways in Kentucky. Coordinates outside Kentucky will typically return no results within the default snap distance.
