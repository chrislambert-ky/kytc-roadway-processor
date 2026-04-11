# KYTC LRS — Google Sheets Add-on

A Google Apps Script add-on that brings Kentucky Transportation Cabinet (KYTC) Linear Referencing System (LRS) roadway attribute lookups directly into Google Sheets. Query the KYTC Spatial API by coordinate, right from your spreadsheet.

---

## What It Does

| Feature | Description |
|---------|-------------|
| `=KYTC_LRS(lat, lon, field)` | Returns a single LRS attribute for a coordinate pair |
| `=KYTC_LRS_MULTI(lat, lon, fields)` | Returns multiple attributes in one API call; results spill horizontally |
| `=KYTC_FIELDS()` | Returns the full live field catalog as a spill table |
| **KYTC › Process Sheet…** | Batch processes an entire sheet and writes static values — no formulas |

---

## Installation

The add-on is not published to the Google Workspace Marketplace. You install it manually by copying the source files into a Google Apps Script project bound to your spreadsheet.

### Step 1 — Open Apps Script

1. Open the Google Sheet you want to use with this add-on.
2. In the menu bar, go to **Extensions → Apps Script**.
3. The Apps Script editor opens in a new tab.

### Step 2 — Copy the source files

You need four files. For each one, create a new file in the Apps Script editor (or replace the default `Code.gs`) and paste in the corresponding content from this repo.

| Apps Script file | Source file in repo |
|-----------------|---------------------|
| `Code.gs` | `sheets-addon/Code.gs` |
| `ProcessDialog.html` | `sheets-addon/ProcessDialog.html` |
| `Sidebar.html` | `sheets-addon/Sidebar.html` |
| `appsscript.json` | `sheets-addon/appsscript.json` |

**To add a new HTML file:** click the **+** button next to "Files" in the left panel → choose **HTML** → name it exactly `ProcessDialog` or `Sidebar` (no extension — Apps Script adds `.html` automatically).

**To edit `appsscript.json`:** click the gear icon (Project Settings) → check **Show "appsscript.json" manifest file in editor** → the file will appear in the file list.

### Step 3 — Save

Press **Ctrl+S** (or **Cmd+S**) to save all files. The editor will show a floppy-disk icon while saving.

### Step 4 — Authorize

1. In the Apps Script editor, select `onOpen` from the function dropdown and click **Run** (▶).
2. A permissions dialog will appear. Click **Review permissions**.
3. Choose your Google account.
4. You may see a warning that the app is not verified — click **Advanced → Go to [project name] (unsafe)**.
5. Click **Allow** to grant the two required permissions:
   - Access to the spreadsheet it is attached to
   - Make requests to external URLs (the KYTC API)

> This authorization step only needs to be done once per Google account per spreadsheet.

### Step 5 — Reload the spreadsheet

Close the Apps Script tab and reload your Google Sheet. A **KYTC** menu will appear in the menu bar next to **Help**.

---

## Usage

### KYTC menu

After installation, the **KYTC** menu contains:

| Menu item | What it does |
|-----------|-------------|
| **Process Sheet…** | Opens the batch processing dialog |
| **Field Reference** | Opens a searchable field catalog sidebar |
| **Clear cache** | Invalidates all cached API results |
| **About** | Version and usage summary |

---

### Batch processing — Process Sheet (recommended for datasets)

Process Sheet is the primary workflow for datasets. It reads coordinates from every row, calls the KYTC API, and writes the results directly into the sheet as **plain static values** — not formulas. Values persist until you explicitly re-run. Since the LRS updates weekly, one run per week is sufficient.

**Steps:**

1. Make sure your sheet has a header row (row 1) with column names.
2. Click **KYTC → Process Sheet…**
3. In the dialog:
   - **Latitude column / Longitude column** — select the columns containing your coordinates. The dialog auto-detects columns named `LAT`, `LATITUDE`, `Y`, `LON`, `LONG`, `LONGITUDE`, or `X`.
   - **Fields to append** — check the LRS attributes you want written to the sheet. The 29 high-reliability (100%-complete) fields are pre-checked. Additional fields are available in the "Additional fields" box.
   - **Snap distance (feet)** — how far from each coordinate to search for a centerline. Default is 100 ft; increase for points not on state-maintained roads.
   - **Force reprocess** — leave unchecked to skip rows that already have values (useful for appending new rows). Check to overwrite everything.
4. Click **Run**.

Progress toasts appear in the sheet corner as batches complete. A summary is shown in the dialog when finished.

**Performance:** The batch processor uses `UrlFetchApp.fetchAll()` to fire up to 50 API requests simultaneously — the same parallel strategy as the web app. Duplicate coordinates in your sheet are deduplicated automatically; each unique location costs only one API call. Results are cached for 6 hours, so re-running on the same data is nearly instant.

**Output columns:** If a requested field column does not yet exist in row 1, it is added automatically to the right of the existing columns.

---

### Custom functions — one-off lookups

For a handful of coordinates, you can use spreadsheet formulas directly.

> **For datasets with more than ~10 rows, use Process Sheet instead.** Custom functions re-execute every time the sheet recalculates (on open, on cell edits, periodically), which can cause timeouts or excessive API calls on large sheets. Process Sheet writes static values that never recalculate.

#### `=KYTC_LRS(lat, lon, field, [snapFt])`

Returns a single KYTC LRS attribute for a coordinate pair.

| Argument | Type | Description |
|----------|------|-------------|
| `lat` | number | Latitude in decimal degrees (WGS84). Kentucky: ~36.5°–39.1° N |
| `lon` | number | Longitude in decimal degrees (WGS84). Kentucky: ~−89.6° to −82.0° W |
| `field` | string | KYTC return key, e.g. `"County_Name"` |
| `snapFt` | number (optional) | Snap distance in feet, 1–5000. Default: 100 |

**Examples:**

```
=KYTC_LRS(A2, B2, "County_Name")
=KYTC_LRS(A2, B2, "Route_Unique_Identifier", 100)
=KYTC_LRS(A2, B2, "Milepoint", 500)
```

Returns the field value, `No match` (coordinate is not near a state-maintained road), or `Error: …`.

---

#### `=KYTC_LRS_MULTI(lat, lon, fields, [snapFt])`

Returns multiple LRS attributes in a single API call. Results spill horizontally into adjacent cells — enter the formula in the leftmost cell and leave the cells to the right empty.

| Argument | Type | Description |
|----------|------|-------------|
| `lat` | number | Latitude in decimal degrees |
| `lon` | number | Longitude in decimal degrees |
| `fields` | string | Comma-separated list of KYTC return keys |
| `snapFt` | number (optional) | Snap distance in feet. Default: 100 |

**Example:**

```
=KYTC_LRS_MULTI(A2, B2, "County_Name,Route_Label,Milepoint,Snap_Distance_Feet")
```

Produces four values across four cells: `| Hardin | KY 313 | 2.847 | 23 |`

---

#### `=KYTC_FIELDS()`

Returns the full live field catalog as a three-column spill table: **Key**, **Description**, **Coverage**.

Enter in any empty cell and let the result spill downward. No arguments required.

Coverage values:

| Value | Meaning |
|-------|---------|
| `Always` | Field is present on every snapped result (100% complete) |
| `Recommended` | High completeness (85–99%) |
| `Situational` | Completeness varies by road type or dataset (<85%) |

---

### Field Reference sidebar

**KYTC → Field Reference** opens a sidebar listing all available return keys with descriptions and coverage badges. Features:

- Defaults to showing only **Always** and **Recommended** fields (~35 fields)
- Click **Show all fields** to see all 109 fields
- Use the search box to filter by key name or description
- Click any field name to copy it to your clipboard

---

### Clearing the cache

**KYTC → Clear cache** invalidates all stored API results. The next run will fetch fresh data from the API for every coordinate.

When to clear the cache:
- After the KYTC LRS publishes its weekly update and you need the latest values
- After copying a new version of `Code.gs` into Apps Script (to avoid stale results from old cache entries)
- If you suspect cached results are incorrect

The cache uses a generation counter stored in PropertiesService. Clearing the cache increments the generation, which orphans all previous entries without needing to enumerate them individually.

---

## Default Fields

The 29 fields pre-checked in Process Sheet are the 100%-complete fields — attributes that are present on every successfully snapped result, regardless of road type or jurisdiction.

| Group | Fields |
|-------|--------|
| Identity & jurisdiction | `District_Number`, `District_Name`, `County_Number`, `County_Name`, `Government_Level`, `Ownership_Status` |
| Route | `Route_Label`, `Route`, `Route_Type`, `Route_Prefix`, `Route_Number`, `Route_Section`, `Route_Unique_Identifier`, `Road_Name`, `Road_Shield_Label` |
| Travel characteristics | `Cardinality`, `Side_of_Road`, `Type_Operation`, `Functional_Class`, `Surface_Type`, `Snow_Ice_Priority_Route_Type`, `National_Hwy_System`, `Federal_System_Roadway_Status` |
| Location on route | `Milepoint`, `Urban_Area_Census` |
| Snap quality | `Snap_Distance_Feet`, `Snap_Probability`, `Snap_Status` |

Additional fields (speed limits, lane counts, traffic counts, shoulder widths, etc.) are available and can be added via the "Additional fields" box in Process Sheet, or typed directly into a `=KYTC_LRS()` formula. Browse them in the Field Reference sidebar.

---

## Coordinate Requirements

- Coordinates must be in **decimal degrees, WGS84** (EPSG:4326) — the same format used by GPS devices and Google Maps.
- Kentucky bounds: latitude **36.5°–39.1° N**, longitude **−89.6° to −82.0° W**.
- Negative sign is required for longitude (e.g. `−85.747836`, not `85.747836`).
- Points must be within the default snap distance of a **state-maintained** road centerline to return a result. Points on local subdivision streets or private roads will return `No match` unless the snap distance is increased significantly.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| No KYTC menu after reload | Authorization not completed | Run `onOpen` from the function dropdown in the Apps Script editor and re-authorize |
| `No match` for all rows | Coordinates off-road, or wrong column selected | Verify lat/lon values are correct; try increasing snap distance to 500 ft |
| `No match` for some fields but not others | Stale partial-field cache entry from an older version of the add-on | Run **KYTC → Clear cache**, then re-run Process Sheet |
| `Error: coordinate out of valid range` | Lat and lon columns swapped | Check that latitude (~37–39) is in the lat column and longitude (~−82 to −89) is in the lon column |
| Dialog says "No column headers found" | Row 1 is empty | Make sure your data has a header row with column names in row 1 |
| Custom function returns `#ERROR!` or times out | Too many formula cells recalculating at once | Replace formulas with Process Sheet — it writes static values and avoids this entirely |

---

## API Reference

- **Endpoint:** `https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/route/GetRouteInfoByCoordinates`
- **Field catalog:** `https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/utilities/GetReturnKeyInfo?service=GetRouteInfoByCoordinates`
- **Interactive docs:** [https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/docs](https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/docs)

The API is public and requires no authentication. All requests are made directly from Google's servers via `UrlFetchApp` — no data passes through any third-party server.
