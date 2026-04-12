/**
 * KYTC Linear Referencing System (LRS) — Google Sheets Add-on
 * =============================================================
 * Provides batch processing and custom spreadsheet functions for the
 * Kentucky Transportation Cabinet Spatial API.
 *
 * Batch processing (recommended for datasets):
 *   KYTC › Process Sheet…
 *       Reads coordinates from your sheet, calls the API once per unique
 *       coordinate, and writes static values directly into cells. Values
 *       persist until you explicitly re-run. The LRS updates weekly, so
 *       running once per week is sufficient to reflect the latest data.
 *
 * Custom functions (good for one-off lookups):
 *   =KYTC_LRS(lat, lon, field, [snapFt])
 *       Returns a single attribute for a coordinate pair.
 *       Example: =KYTC_LRS(A2, B2, "County_Name")
 *
 *   =KYTC_LRS_MULTI(lat, lon, fields, [snapFt])
 *       Makes ONE API call and spills multiple attributes across adjacent cells.
 *       Example: =KYTC_LRS_MULTI(A2, B2, "County_Name,Route_Label,Milepoint")
 *       Enter in the leftmost cell; the results spill right automatically.
 *
 *   =KYTC_FIELDS()
 *       Returns the live field catalog as a two-column table [Key, Description].
 *       Enter in any cell and let the result spill downward.
 *
 * Caching:
 *   All API results are cached for 6 hours using Apps Script's CacheService.
 *   The cache is keyed by (lat, lon, snap_distance), so multiple calls for
 *   the same coordinate never trigger more than one real API request within
 *   a session. Duplicate coordinates in a sheet cost only one API call.
 *
 * API reference: https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/docs
 */

var KYTC_BASE_URL = 'https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app';

// Default fields — the 100% complete fields from the KYTC API (always returned for any snapped point).
// Cross-referenced with FIELD_COVERAGE in workflow-app.js. Internal/geometry fields excluded.
// Cache generation counter — incremented by clearKytcCache() to orphan all
// stale entries without needing to enumerate them. Memoized per execution so
// PropertiesService is only read once per runProcessSheet / custom-function call.
var _cacheGenMemo = null;
function _cacheGen() {
  if (_cacheGenMemo === null) {
    _cacheGenMemo = PropertiesService.getScriptProperties()
      .getProperty('kytc_cache_gen') || '1';
  }
  return _cacheGenMemo;
}

var DEFAULT_FIELDS = [
  // Identity & jurisdiction
  'District_Number',
  'District_Name',
  'County_Number',
  'County_Name',
  'Government_Level',
  'Ownership_Status',
  // Route
  'Route_Label',
  'Route',
  'Route_Type',
  'Route_Prefix',
  'Route_Number',
  'Route_Section',
  'Route_Unique_Identifier',
  'Road_Name',
  'Road_Shield_Label',
  // Travel characteristics
  'Cardinality',
  'Side_of_Road',
  'Type_Operation',
  'Functional_Class',
  'Surface_Type',
  'Snow_Ice_Priority_Route_Type',
  'National_Hwy_System',
  'Federal_System_Roadway_Status',
  // Location on route
  'Milepoint',
  'Urban_Area_Census',
  // Snap quality
  'Snap_Distance_Feet',
  'Snap_Probability',
  'Snap_Status',
];


// Field completeness percentages — sourced from workflow-app.js FIELD_COVERAGE.
// Keys not listed here are either 100% (always returned) or have unknown coverage.
var FIELD_COVERAGE = {
  // Recommended (85–99%)
  Bridge_Feature_Intersect: 91.89, Bridge_Identifier: 91.89,
  Traffic_ADT_Station: 87.69, Traffic_ADT_Station_Type: 87.69,
  Traffic_Last_Count: 87.69, Traffic_Last_Count_Year: 87.67,
  // Situational (<85%)
  Reimbursable_Route_Type: 63.16, Lanes_Total_Number_Driving: 62.21,
  Lane_Width_Feet: 62.21, Median_Width_Feet: 61.9, Median_Type_of_Roadway: 61.9,
  Speed_Limit_Posted_MPH: 61.85, Direction: 61.79, State_System_Classification: 61.01,
  Access_Control_Type: 59.77, Truck_Weight_Limit_Class: 59.66,
  Truck_Weight_Route_Description: 59.64, Horizontal_Curve_Class: 58.67,
  Traffic_ADT_Source: 57.67, Lanes_Number_Cardinal: 56.22,
  Shoulder_Type_Cardinal_Right: 55.92, Shoulder_Width_Cardinal_Right_Feet: 55.92,
  Shoulder_Surface_Width_Cardinal_Right_Feet: 55.92, Lanes_Number_NonCardinal: 55.58,
  Shoulder_Width_NonCardinal_Right_Feet: 55.56, Shoulder_Type_NonCardinal_Right: 55.56,
  Shoulder_Surface_Width_NonCardinal_Right_Feet: 55.56,
  Federal_System_Route_Description: 49.74, Grade_Class: 36.61,
  Grade_Direction: 35.6, Horizontal_Curve_Degree: 35.44, Grade_Percent: 30.02,
  Grade_Incoming: 29.84, Grade_Outgoing: 29.84, Grade_Absolute_Difference: 29.57,
  Horizontal_Curve_Direction: 27.78, Freight_Network_KY_Designation: 22.04,
  City: 16.96, Speed_Limit_Official_Order: 13.44,
  NATL_Truck_Network_Route_Description: 12.96, NATL_Truck_Network_Commercial_Vehicle_Access: 12.96,
  Median_Type: 12.78, NATL_Freight_Designation: 7.64,
  Horizontal_Curve_SuperElevation_Cardinal: 6.96, Horizontal_Curve_SuperElevation_NonCardinal: 6.41,
  Extended_Weight_System: 6.32, Shoulder_Type_Cardinal_Left: 6.09,
  Shoulder_Width_Cardinal_Left_Feet: 6.09, Shoulder_Surface_Width_Cardinal_Left_Feet: 6.09,
  Strategic_Hwy_Network: 6.07, Shoulder_Surface_Width_NonCardinal_Left_Feet: 5.81,
  Shoulder_Type_NonCardinal_Left: 5.81, Shoulder_Width_NonCardinal_Left_Feet: 5.81,
  Route_Suffix: 5.17, Median_Barrier_Type: 4.44,
  Scenic_Byway_Effective_Date: 3.44, Scenic_Byway_Route_Sequence: 3.44,
  Scenic_Byway_Road_Name: 3.44, Scenic_Byway_Route: 3.44,
  Scenic_Byway_Route_Description: 3.44, NATL_Freight_Critical_Corridor_ID1: 2.39,
  Appalachian_Hwy_Route_Sequence: 1.81, Appalachian_Hwy_Section_Length_for_Cost_Estimating: 1.81,
  Appalachian_Hwy_Roadway_Status: 1.81, Appalachian_Hwy_Begin_Description: 1.81,
  Appalachian_Hwy_Corridor: 1.81, Appalachian_Hwy_End_Description: 1.81,
  Appalachian_Hwy_Section_ID: 1.81, Coal_Haul_Annual_Tons_NonCardinal: 1.47,
  Enhanced_National_Hwy_System: 1.02, Coal_Haul_Annual_Tons_Cardinal: 0.82,
  Forest_Hwy_System: 0.5, Forest_Hwy_Route_Number: 0.5, Forest_Hwy_Route_Sequence: 0.5,
  Forest_Hwy_Road: 0.5, Forest_Hwy_Route_Description: 0.5,
  National_Hwy_System_Terminal: 0.12, State_System_Toll_Road: 0.11,
};

/**
 * Returns 'Always' (100%), 'Recommended' (≥85%), or 'Situational' (<85%)
 * for a given field key, based on observed API completeness.
 * @param {string} key
 * @return {string}
 */
function _fieldCoverage(key) {
  if (key in FIELD_COVERAGE) {
    return FIELD_COVERAGE[key] >= 85 ? 'Recommended' : 'Situational';
  }
  return 'Always'; // 100% complete — always returned for any snapped point
}


// ── Menu ──────────────────────────────────────────────────────────────────────

/**
 * Adds a "KYTC" menu to the Sheets toolbar when the spreadsheet is opened.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('KYTC')
    .addItem('Process Sheet…', 'showProcessDialog')
    .addSeparator()
    .addItem('Field Reference', 'showSidebar')
    .addSeparator()
    .addItem('Clear cache', 'clearKytcCache')
    .addSeparator()
    .addItem('About', 'showAbout')
    .addToUi();
}

/**
 * Opens the Process Sheet modal dialog.
 */
function showProcessDialog() {
  var html = HtmlService.createHtmlOutputFromFile('ProcessDialog')
    .setWidth(500)
    .setHeight(580);
  SpreadsheetApp.getUi().showModalDialog(html, 'KYTC Roadway Processor');
}

/**
 * Opens the KYTC Field Reference sidebar.
 */
function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('KYTC Roadway Processor')
    .setWidth(320);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Clears all cached KYTC API results.
 * Run this manually from the Apps Script editor after updating the add-on,
 * or whenever you want to force fresh API calls for all coordinates.
 */
function clearKytcCache() {
  // Apps Script's CacheService has no "clear all" API — removeAll([]) with an
  // empty array removes nothing. Instead we increment a generation counter stored
  // in PropertiesService. All cache keys include the generation, so existing
  // entries from the old generation simply stop being looked up.
  var props = PropertiesService.getScriptProperties();
  var gen = parseInt(props.getProperty('kytc_cache_gen') || '1', 10);
  props.setProperty('kytc_cache_gen', String(gen + 1));
  _cacheGenMemo = null; // reset in-execution memoized value
  SpreadsheetApp.getActive().toast('KYTC cache cleared (generation ' + (gen + 1) + '). Next run will fetch fresh data.', 'KYTC LRS');
  Logger.log('KYTC cache cleared — now generation ' + (gen + 1) + '.');
}

/**
 * DEBUG — Run this directly from the Apps Script editor (not the sheet).
 * Logs the raw URL, HTTP status, and full response body for a known-good
 * Kentucky coordinate so you can see exactly what the API returns.
 * Check the output under View > Logs (Ctrl+Enter) after running.
 */
function debugApiCall() {
  // Bridge location — guaranteed to snap (bridge_locations.csv row 1)
  var lat = 37.716616;
  var lon = -85.747836;

  // Test 1: with return_keys, snap=100
  _debugFetch(lat, lon, 100, 'County_Name', 'Test1 snap=100 with return_keys');

  // Test 2: WITHOUT return_keys at all (let the API return everything)
  _debugFetch(lat, lon, 100, null, 'Test2 snap=100 NO return_keys');

  // Test 3: larger snap distance
  _debugFetch(lat, lon, 500, 'County_Name', 'Test3 snap=500 with return_keys');
}

function _debugFetch(lat, lon, snap, keys, label) {
  var paramParts = [
    'xcoord=' + lon,
    'ycoord=' + lat,
    'snap_distance=' + snap,
    'return_format=json',
    'input_epsg=4326',
    'output_epsg=4326',
    'request_id=debug',
  ];
  if (keys) paramParts.splice(3, 0, 'return_keys=' + keys);

  var url = KYTC_BASE_URL + '/api/route/GetRouteInfoByCoordinates?' + paramParts.join('&');
  Logger.log('--- ' + label + ' ---');
  Logger.log('URL: ' + url);

  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var code = response.getResponseCode();
  var body = response.getContentText();
  Logger.log('HTTP ' + code + ' | body: ' + body.substring(0, 500));

  try {
    var data = JSON.parse(body);
    var routeInfo = _extractRouteInfo(data);
    Logger.log('routeInfo: ' + JSON.stringify(routeInfo));
    if (routeInfo && keys) Logger.log(keys + ' = ' + routeInfo[keys]);
  } catch (e) {
    Logger.log('parse error: ' + e.message);
  }
}

/**
 * Shows a brief About dialog.
 */
function showAbout() {
  var html = HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="UTF-8">'
    + '<base target="_blank">'
    + '<style>'
    + 'body{font-family:"Google Sans",Roboto,Arial,sans-serif;font-size:13px;color:#202124;margin:0;padding:16px 18px;}'
    + 'h2{font-size:15px;font-weight:600;margin:0 0 10px;color:#1a73e8;}'
    + 'p{margin:0 0 8px;line-height:1.5;font-size:12px;}'
    + '.section{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#5f6368;margin:12px 0 4px;}'
    + 'ul{margin:0 0 8px;padding-left:18px;font-size:12px;line-height:1.6;}'
    + 'code{font-family:"Roboto Mono",monospace;background:#f8f9fa;padding:1px 4px;border-radius:3px;font-size:11px;color:#0d652d;}'
    + 'a{color:#1a73e8;}'
    + '.footer{margin-top:14px;padding-top:10px;border-top:1px solid #e8eaed;font-size:11px;color:#5f6368;}'
    + '.btn-row{display:flex;justify-content:flex-end;margin-top:14px;}'
    + 'button{padding:7px 20px;border-radius:6px;font-size:13px;font-family:inherit;cursor:pointer;background:#1a73e8;color:#fff;border:none;font-weight:500;}'
    + 'button:hover{background:#1765cc;}'
    + '</style></head><body>'
    + '<h2>KYTC Roadway Processor</h2>'
    + '<p>Batch processing and custom formulas for the Kentucky Transportation Cabinet'
    + ' Linear Referencing System (LRS) Spatial API.</p>'
    + '<div class="section">What you can do</div>'
    + '<ul>'
    + '<li><strong>Process Sheet</strong> &mdash; writes LRS attributes directly into your sheet'
    + ' as static values for every coordinate row. Re-run weekly to stay current with the LRS.</li>'
    + '<li><strong>Field Reference sidebar</strong> &mdash; browse and copy all available return'
    + ' field names, filtered to reliable fields by default.</li>'
    + '<li><strong>Clear cache</strong> &mdash; forces fresh API calls on the next run or formula recalc.</li>'
    + '</ul>'
    + '<div class="section">Custom formulas</div>'
    + '<ul>'
    + '<li><code>=KYTC_LRS(lat, lon, "Field")</code> &mdash; single field lookup</li>'
    + '<li><code>=KYTC_LRS_MULTI(lat, lon, "Field1,Field2,\u2026")</code> &mdash; spills right</li>'
    + '<li><code>=KYTC_FIELDS()</code> &mdash; spills the full field catalog with coverage info</li>'
    + '</ul>'
    + '<div class="footer">'
    + 'Full setup guide and field reference: '
    + '<a href="https://github.com/chrislambert-ky/kytc-roadway-processor/blob/main/sheets-addon/README.md">'
    + 'sheets-addon/README.md</a>'
    + '</div>'
    + '<div class="btn-row"><button onclick="google.script.host.close()">Close</button></div>'
    + '</body></html>'
  ).setWidth(460).setHeight(360);
  SpreadsheetApp.getUi().showModalDialog(html, 'KYTC Roadway Processor');
}


// ── Server functions called by dialogs ───────────────────────────────────────

/**
 * Returns the column headers of the active sheet.
 * Called by ProcessDialog via google.script.run.
 * @return {string[]}
 */
function getSheetHeaders() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastCol === 0) return { headers: [], lastRow: lastRow };
  return {
    headers: sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String),
    lastRow: lastRow,
  };
}

/**
 * Returns the row bounds of the user's current sheet selection, clamped to
 * data rows (row 2 onwards). Returns null if the selection covers only the
 * header or there is no active selection.
 * Called by ProcessDialog via google.script.run.
 * @return {{firstRow:number, lastRow:number, rowCount:number}|null}
 */
function getActiveRangeNotation() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var range = sheet.getActiveRange();
  if (!range) return null;
  var sheetLastRow = sheet.getLastRow();
  var firstRow = Math.max(2, range.getRow());
  var lastRow = Math.min(sheetLastRow, range.getLastRow());
  if (firstRow > lastRow) return null;
  return { firstRow: firstRow, lastRow: lastRow, rowCount: lastRow - firstRow + 1 };
}

/**
 * Batch-processes the active sheet using the same strategy as the web app:
 *   1. Deduplicate coordinates — each unique lat/lon pair calls the API only once.
 *   2. Check cache — already-cached results are served instantly.
 *   3. Parallel fetch — all remaining unique coordinates are fired concurrently
 *      via UrlFetchApp.fetchAll(), matching the web app's Promise.all() approach.
 *   4. cache.putAll() — all new results are written to cache in one call.
 *   5. Single write — all output columns are written to the sheet in one batch.
 *
 * Called by ProcessDialog via google.script.run.
 *
 * @param {Object}   config
 * @param {string}   config.latCol         Header name of the latitude column.
 * @param {string}   config.lonCol         Header name of the longitude column.
 * @param {string[]} config.fields         KYTC return keys to write.
 * @param {number}   config.snap           Snap distance in feet (1–5000).
 * @param {boolean}  config.forceReprocess Overwrite cells that already have values.
 * @return {Object} { success, skipped, noMatch, errors, total } or { error }
 */
function runProcessSheet(config) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow < 2) {
    return { error: 'No data rows found (sheet has only a header row or is empty).' };
  }

  // ── Read sheet data ───────────────────────────────────────────────────────
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  var latIdx = headers.indexOf(config.latCol);
  var lonIdx = headers.indexOf(config.lonCol);
  if (latIdx === -1) return { error: 'Latitude column "' + config.latCol + '" not found in row 1.' };
  if (lonIdx === -1) return { error: 'Longitude column "' + config.lonCol + '" not found in row 1.' };

  var fieldCols = {};
  config.fields.forEach(function (f) {
    var idx = headers.indexOf(f);
    if (idx === -1) {
      lastCol++;
      headers.push(f);
      idx = headers.length - 1;
      sheet.getRange(1, idx + 1).setValue(f);
    }
    fieldCols[f] = idx;
  });

  var snap = Math.min(5000, Math.max(1, parseInt(config.snap, 10) || 100));
  var firstDataRow = (config.firstDataRow >= 2) ? config.firstDataRow : 2;
  var lastDataRow = (config.lastDataRow && config.lastDataRow <= lastRow) ? config.lastDataRow : lastRow;
  var total = lastDataRow - firstDataRow + 1;
  var latVals = sheet.getRange(firstDataRow, latIdx + 1, total, 1).getValues();
  var lonVals = sheet.getRange(firstDataRow, lonIdx + 1, total, 1).getValues();

  var existing = {};
  if (!config.forceReprocess) {
    config.fields.forEach(function (f) {
      var col = fieldCols[f];
      if (col < sheet.getLastColumn()) {
        existing[f] = sheet.getRange(firstDataRow, col + 1, total, 1).getValues();
      }
    });
  }

  // ── Step 1: Classify each row + deduplicate coordinates ──────────────────
  // rowStatus[i]: 'blank' | 'skip' | 'invalid' | 'api'
  var rowStatus = [];
  var coordKeyMap = {}; // "lat6|lon6" → index of first row with that coordinate

  for (var i = 0; i < total; i++) {
    var lat = latVals[i][0];
    var lon = lonVals[i][0];

    var isBlank = (lat === '' || lat === null || lat === undefined) &&
                  (lon === '' || lon === null || lon === undefined);
    if (isBlank) { rowStatus.push('blank'); continue; }

    var needsProcessing = config.forceReprocess || config.fields.some(function (f) {
      if (!existing[f]) return true;
      var v = existing[f][i][0];
      return v === '' || v === null || v === undefined;
    });
    if (!needsProcessing) { rowStatus.push('skip'); continue; }

    if (_validateCoords(lat, lon)) { rowStatus.push('invalid'); continue; }

    rowStatus.push('api');
    var ck = Number(lat).toFixed(6) + '|' + Number(lon).toFixed(6);
    if (!(ck in coordKeyMap)) coordKeyMap[ck] = i; // record first occurrence
  }

  // ── Step 2: Serve cached results; collect what still needs fetching ───────
  var cache = CacheService.getScriptCache();
  var coordResults = {}; // ck → routeInfo object (or null for no-match)
  var toFetch = [];      // { ck, lat, lon, cacheKey }

  Object.keys(coordKeyMap).forEach(function (ck) {
    var firstIdx = coordKeyMap[ck];
    var lat = Number(latVals[firstIdx][0]);
    var lon = Number(lonVals[firstIdx][0]);
    var cacheKey = _cacheKey(lat, lon, snap);
    var cached = cache.get(cacheKey);
    if (cached) {
      coordResults[ck] = JSON.parse(cached);
    } else {
      toFetch.push({ ck: ck, lat: lat, lon: lon, cacheKey: cacheKey });
    }
  });

  // ── Step 3: Parallel fetch in batches via UrlFetchApp.fetchAll() ──────────
  // Mirrors the web app's Promise.all() batching. Batch size of 50 is safe and
  // well within Apps Script's concurrent request comfort zone.
  // No return_keys sent — full responses cached so any field is servable.
  var BATCH_SIZE = 50;

  for (var b = 0; b < toFetch.length; b += BATCH_SIZE) {
    var slice = toFetch.slice(b, b + BATCH_SIZE);

    var requests = slice.map(function (item) {
      var params = [
        'xcoord=' + item.lon,
        'ycoord=' + item.lat,
        'snap_distance=' + snap,
        'return_format=json',
        'input_epsg=4326',
        'output_epsg=4326',
        'request_id=sheets-batch',
      ].join('&');
      return {
        url: KYTC_BASE_URL + '/api/route/GetRouteInfoByCoordinates?' + params,
        muteHttpExceptions: true,
      };
    });

    var responses = UrlFetchApp.fetchAll(requests);

    // Separate successes from transient errors needing a retry
    var retryItems = [];
    var cacheMap = {};

    responses.forEach(function (resp, j) {
      var item = slice[j];
      var code = resp.getResponseCode();
      if (code === 200) {
        try {
          var routeInfo = _extractRouteInfo(JSON.parse(resp.getContentText()));
          coordResults[item.ck] = routeInfo;
          cacheMap[item.cacheKey] = JSON.stringify(routeInfo || { __no_match: true });
        } catch (e) {
          coordResults[item.ck] = null;
          cacheMap[item.cacheKey] = JSON.stringify({ __no_match: true });
        }
      } else if (code === 500 || code === 503) {
        retryItems.push(item); // retry once after a short back-off
      } else {
        coordResults[item.ck] = null;
        cacheMap[item.cacheKey] = JSON.stringify({ __no_match: true });
      }
    });

    // Single retry pass for 500/503 — mirrors web app's fetchJsonWithRetry()
    if (retryItems.length > 0) {
      Utilities.sleep(500);
      var retryReqs = retryItems.map(function (item) {
        var params = [
          'xcoord=' + item.lon,
          'ycoord=' + item.lat,
          'snap_distance=' + snap,
          'return_format=json',
          'input_epsg=4326',
          'output_epsg=4326',
          'request_id=sheets-batch-retry',
        ].join('&');
        return {
          url: KYTC_BASE_URL + '/api/route/GetRouteInfoByCoordinates?' + params,
          muteHttpExceptions: true,
        };
      });
      UrlFetchApp.fetchAll(retryReqs).forEach(function (resp, j) {
        var item = retryItems[j];
        var routeInfo = null;
        if (resp.getResponseCode() === 200) {
          try { routeInfo = _extractRouteInfo(JSON.parse(resp.getContentText())); } catch (e) {}
        }
        coordResults[item.ck] = routeInfo;
        cacheMap[item.cacheKey] = JSON.stringify(routeInfo || { __no_match: true });
      });
    }

    // Batch-write all new results to cache in one call
    if (Object.keys(cacheMap).length > 0) {
      cache.putAll(cacheMap, 21600);
    }

    if (toFetch.length > BATCH_SIZE) {
      SpreadsheetApp.getActive().toast(
        'Fetched ' + Math.min(b + BATCH_SIZE, toFetch.length) + ' of ' + toFetch.length + ' unique coordinates…',
        'KYTC LRS'
      );
    }
  }

  // ── Step 4: Build output arrays ───────────────────────────────────────────
  var output = {};
  config.fields.forEach(function (f) { output[f] = []; });
  var successCount = 0, skippedCount = 0, noMatchCount = 0, errorCount = 0;

  for (var i = 0; i < total; i++) {
    var status = rowStatus[i];

    if (status === 'blank') {
      config.fields.forEach(function (f) { output[f].push(['']); });

    } else if (status === 'skip') {
      config.fields.forEach(function (f) {
        output[f].push([existing[f] ? existing[f][i][0] : '']);
      });
      skippedCount++;

    } else if (status === 'invalid') {
      config.fields.forEach(function (f) { output[f].push(['Invalid coordinates']); });
      errorCount++;

    } else {
      // 'api' — look up the result by coordinate key (shared among duplicates)
      var ck = Number(latVals[i][0]).toFixed(6) + '|' + Number(lonVals[i][0]).toFixed(6);
      var routeInfo = coordResults[ck];
      if (!routeInfo || routeInfo.__no_match) {
        config.fields.forEach(function (f) { output[f].push(['No match']); });
        noMatchCount++;
      } else {
        config.fields.forEach(function (f) {
          var v = routeInfo[f];
          output[f].push([v !== undefined && v !== null ? v : '']);
        });
        successCount++;
      }
    }
  }

  // ── Step 5: Write all output columns in one batch per field ───────────────
  config.fields.forEach(function (f) {
    sheet.getRange(firstDataRow, fieldCols[f] + 1, total, 1).setValues(output[f]);
  });

  SpreadsheetApp.getActive().toast(
    successCount + ' matched · ' + noMatchCount + ' unmatched · '
      + skippedCount + ' skipped · ' + errorCount + ' errors',
    'KYTC LRS — Done', 8
  );

  return {
    success: successCount,
    skipped: skippedCount,
    noMatch: noMatchCount,
    errors: errorCount,
    total: total,
  };
}


// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Validates coordinate inputs. Returns an error string if invalid, null if ok.
 * @param {*} lat
 * @param {*} lon
 * @return {string|null}
 */
function _validateCoords(lat, lon) {
  if (lat == null || lat === '' || lon == null || lon === '') {
    return 'Error: lat and lon are required.';
  }
  var latNum = Number(lat);
  var lonNum = Number(lon);
  if (!isFinite(latNum) || !isFinite(lonNum)) {
    return 'Error: lat and lon must be numeric.';
  }
  if (Math.abs(latNum) > 90 || Math.abs(lonNum) > 180) {
    return 'Error: coordinate out of valid range.';
  }
  return null;
}

/**
 * Builds a 6-decimal-place cache key for a given coordinate + snap distance.
 * Rounding prevents floating-point key mismatches for the same coordinate.
 * @param {number} lat
 * @param {number} lon
 * @param {number} snap
 * @return {string}
 */
function _cacheKey(lat, lon, snap) {
  // Prefix includes 'g' + generation so clearKytcCache() orphans all old entries.
  // Old 'kytc_' keys (generation-less) are never looked up after this change.
  return 'kytcg' + _cacheGen() + '_' + Number(lat).toFixed(6) + '_' + Number(lon).toFixed(6) + '_' + snap;
}

/**
 * Extracts the Route_Info object from an API payload, handling all known
 * response shapes returned by the KYTC API:
 *   - { Route_Info: { ... } }          direct object
 *   - { Route_Info: [ { ... } ] }      array (most common)
 *   - [ { Route_Info: { ... } } ]      wrapped in an outer array
 *   - [ { ... } ]                      flat array with no Route_Info wrapper
 * @param {*} payload
 * @return {Object|null}
 */
function _extractRouteInfo(payload) {
  if (!payload) return null;

  // Most common: { Route_Info: [...] } or { Route_Info: { ... } }
  if (payload.Route_Info && typeof payload.Route_Info === 'object') {
    return Array.isArray(payload.Route_Info)
      ? (payload.Route_Info[0] || null)
      : payload.Route_Info;
  }

  // Outer array wrapping
  if (Array.isArray(payload) && payload.length) {
    var first = payload[0];
    if (first && first.Route_Info) {
      return Array.isArray(first.Route_Info)
        ? (first.Route_Info[0] || null)
        : first.Route_Info;
    }
    return (typeof first === 'object') ? first : null;
  }

  return (typeof payload === 'object') ? payload : null;
}

/**
 * Fetches the full Route_Info from the KYTC API for a given coordinate, using a
 * script-level cache (6-hour TTL) to avoid redundant calls.
 *
 * We intentionally do NOT send return_keys — the full response is cached once
 * and covers any future field request for the same coordinate. Filtering to
 * specific fields is done by the caller.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} snap  Snap distance in feet.
 * @return {Object}
 */
function _fetchRouteInfo(lat, lon, snap) {
  var cache = CacheService.getScriptCache();
  var key = _cacheKey(lat, lon, snap);
  var cached = cache.get(key);

  if (cached) {
    return JSON.parse(cached);
  }

  // No return_keys — always request the full response so the cached entry
  // satisfies any field lookup without re-fetching.
  var params = [
    'xcoord=' + Number(lon),
    'ycoord=' + Number(lat),
    'snap_distance=' + snap,
    'return_format=json',
    'input_epsg=4326',
    'output_epsg=4326',
    'request_id=sheets-addon',
  ].join('&');

  var url = KYTC_BASE_URL + '/api/route/GetRouteInfoByCoordinates?' + params;

  // Retry up to 2 times on transient server errors, matching web app behaviour
  var lastCode = 0;
  for (var attempt = 0; attempt <= 2; attempt++) {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    lastCode = response.getResponseCode();

    if (lastCode === 200) {
      var data = JSON.parse(response.getContentText());
      var routeInfo = _extractRouteInfo(data);

      if (!routeInfo) {
        cache.put(key, JSON.stringify({ __no_match: true }), 21600);
        return null;
      }

      cache.put(key, JSON.stringify(routeInfo), 21600);
      return routeInfo;
    }

    if ((lastCode === 500 || lastCode === 503) && attempt < 2) {
      Utilities.sleep(300 * (attempt + 1));
      continue;
    }

    break;
  }

  throw new Error('API returned HTTP ' + lastCode);
}


// ── Custom functions ──────────────────────────────────────────────────────────

/**
 * Returns a single KYTC LRS attribute for a coordinate pair.
 *
 * For datasets with more than a few rows, use KYTC › Process Sheet… instead —
 * it writes static values and only calls the API when you explicitly run it.
 *
 * @param {number} lat       Latitude in decimal degrees (WGS84 / EPSG:4326).
 *                           Kentucky: typically 36.5° to 39.1° N.
 * @param {number} lon       Longitude in decimal degrees (WGS84 / EPSG:4326).
 *                           Kentucky: typically -89.6° to -82.0° W.
 * @param {string} field     The KYTC return key, e.g. "County_Name".
 *                           Open KYTC › Field Reference to browse all available keys.
 * @param {number} [snapFt]  Snap distance in feet (1–5000). Default: 100.
 * @return {string|number}   The field value, "No match", or an "Error: …" string.
 * @customfunction
 */
function KYTC_LRS(lat, lon, field, snapFt) {
  var coordErr = _validateCoords(lat, lon);
  if (coordErr) return coordErr;
  if (!field) return 'Error: field is required.';

  var snap = Math.min(5000, Math.max(1, parseInt(snapFt, 10) || 100));
  var fieldStr = String(field).trim();

  try {
    var routeInfo = _fetchRouteInfo(Number(lat), Number(lon), snap);

    if (!routeInfo || routeInfo.__no_match) return 'No match';

    var value = routeInfo[fieldStr];
    return (value !== undefined && value !== null) ? value : 'No match';

  } catch (e) {
    return 'Error: ' + e.message;
  }
}


/**
 * Returns multiple KYTC LRS attributes for a coordinate pair in one API call.
 * Results spill horizontally — enter in the leftmost cell, leave adjacent cells empty.
 *
 * For datasets with more than a few rows, use KYTC › Process Sheet… instead.
 *
 * Example: =KYTC_LRS_MULTI(A2, B2, "County_Name,Route_Label,Milepoint")
 * Produces: | Fayette | US 60 | 4.321 |  (each in its own cell)
 *
 * @param {number} lat       Latitude in decimal degrees (WGS84 / EPSG:4326).
 * @param {number} lon       Longitude in decimal degrees (WGS84 / EPSG:4326).
 * @param {string} fields    Comma-separated list of KYTC return keys.
 *                           Example: "County_Name,Route_Label,Milepoint"
 * @param {number} [snapFt]  Snap distance in feet (1–5000). Default: 100.
 * @return {Array}           A single-row array of field values.
 * @customfunction
 */
function KYTC_LRS_MULTI(lat, lon, fields, snapFt) {
  var coordErr = _validateCoords(lat, lon);
  if (coordErr) return [[coordErr]];
  if (!fields) return [['Error: fields is required.']];

  var snap = Math.min(5000, Math.max(1, parseInt(snapFt, 10) || 100));
  var fieldList = String(fields).split(',').map(function (f) { return f.trim(); }).filter(Boolean);

  if (fieldList.length === 0) return [['Error: no valid field names provided.']];

  try {
    var routeInfo = _fetchRouteInfo(Number(lat), Number(lon), snap);

    if (!routeInfo || routeInfo.__no_match) {
      return [fieldList.map(function () { return 'No match'; })];
    }

    return [fieldList.map(function (f) {
      var v = routeInfo[f];
      return (v !== undefined && v !== null) ? v : 'No match';
    })];

  } catch (e) {
    return [['Error: ' + e.message]];
  }
}


/**
 * Returns the full list of available KYTC LRS return keys, fetched live from the API.
 * Enter in any cell and let the result spill downward into a three-column table.
 *
 * Coverage column values:
 *   Always      — field is present on every snapped result (100% complete)
 *   Recommended — high completeness (85–99%)
 *   Situational — completeness varies by road type or dataset (<85%)
 *
 * @return {string[][]}  A three-column array: [Key, Description, Coverage].
 * @customfunction
 */
function KYTC_FIELDS() {
  var url = KYTC_BASE_URL + '/api/utilities/GetReturnKeyInfo'
    + '?service=GetRouteInfoByCoordinates';

  try {
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = response.getResponseCode();

    if (code !== 200) {
      return [['Error: API returned HTTP ' + code, '', '']];
    }

    var rows = JSON.parse(response.getContentText());

    if (!Array.isArray(rows) || rows.length === 0) {
      return [['No fields returned', '', '']];
    }

    var result = [['Key', 'Description', 'Coverage']];
    rows.forEach(function (row) {
      if (row.Key) {
        result.push([String(row.Key), String(row.Description || ''), _fieldCoverage(row.Key)]);
      }
    });

    return result;

  } catch (e) {
    return [['Error: ' + e.message, '', '']];
  }
}
