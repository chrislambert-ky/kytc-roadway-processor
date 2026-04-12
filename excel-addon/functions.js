/* global CustomFunctions */

/**
 * KYTC Roadway Processor — Excel Custom Functions
 *
 * =KYTC.LRS(lat, lon, "Field")                  — single field lookup
 * =KYTC.LRS_MULTI(lat, lon, "Field1,Field2,…")  — spills right across columns
 * =KYTC.FIELDS()                                 — full field catalog (3 columns)
 *
 * All API calls fetch the full response and cache it in-memory by coordinate,
 * so any field can be served from a single cache entry without re-fetching.
 *
 * CORS NOTE: The KYTC API must return Access-Control-Allow-Origin: * for
 * cross-origin fetch() calls to succeed in the Excel custom function sandbox.
 */

// Requests go through a Cloudflare Worker proxy so Excel Online's CSP allows them.
// Deploy excel-addon/cf-worker.js to Cloudflare Workers and paste your worker URL below.
const KYTC_ENDPOINT = 'https://kytc-proxy.chrslmbrt.workers.dev';
const KYTC_KEYS_ENDPOINT =
  'https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/utilities/GetReturnKeyInfo'
  + '?service=GetRouteInfoByCoordinates';

// Field completeness — mirrors FIELD_COVERAGE in Code.gs / workflow-app.js.
// Keys not listed here are 100% complete (Always tier).
const FIELD_COVERAGE = {
  Bridge_Feature_Intersect: 91.89, Bridge_Identifier: 91.89,
  Traffic_ADT_Station: 87.69, Traffic_ADT_Station_Type: 87.69,
  Traffic_Last_Count: 87.69, Traffic_Last_Count_Year: 87.67,
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

// In-memory cache — keyed by "lat.toFixed(6)|lon.toFixed(6)|snap".
// Shared across all custom function calls within a session.
const _cache = new Map();

function _cacheKey(lat, lon, snap) {
  return `${lat.toFixed(6)}|${lon.toFixed(6)}|${snap}`;
}

/**
 * Extracts the route info object from any of the 4 API response shapes.
 */
function _extractRouteInfo(data) {
  if (!data) return null;
  // Shape 1: { Route_Info: {...} } or { Route_Info: [{...}] }
  if (data.Route_Info && typeof data.Route_Info === 'object') {
    return Array.isArray(data.Route_Info) ? (data.Route_Info[0] || null) : data.Route_Info;
  }
  // Shape 2: [ { Route_Info: {...} } ] or [ {...} ]
  if (Array.isArray(data) && data.length) {
    const first = data[0];
    if (first?.Route_Info) return first.Route_Info;
    return first;
  }
  // Shape 3: direct object
  return typeof data === 'object' ? data : null;
}

/**
 * Cache-first fetch — always retrieves the full API response (no return_keys),
 * so any field can be served from a single cache entry per coordinate.
 */
async function _fetchRouteInfo(lat, lon, snap) {
  const key = _cacheKey(lat, lon, snap);
  if (_cache.has(key)) return _cache.get(key);

  const params = new URLSearchParams({
    xcoord: String(lon),
    ycoord: String(lat),
    snap_distance: String(snap),
    return_format: 'json',
    input_epsg: '4326',
    output_epsg: '4326',
    request_id: 'excel-cf',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${KYTC_ENDPOINT}?${params}`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const routeInfo = _extractRouteInfo(data);
    _cache.set(key, routeInfo);
    return routeInfo;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Custom Functions ──────────────────────────────────────────────────────────

/**
 * Returns a single KYTC roadway attribute for a coordinate pair.
 * @customfunction
 * @param {number} lat Latitude in decimal degrees (WGS84). Kentucky: ~36.5–39.1.
 * @param {number} lon Longitude in decimal degrees (WGS84). Kentucky: ~-89.6 to -82.0.
 * @param {string} field KYTC return key, e.g. "County_Name". Use =KYTC.FIELDS() to browse.
 * @param {number} [snapFt=100] Snap distance in feet (1–5000). Default: 100.
 * @returns {Promise<string>} The field value, "No match", or an error.
 */
async function LRS(lat, lon, field, snapFt) {
  if (lat == null || lon == null || !field)
    throw new CustomFunctions.Error(CustomFunctions.ErrorCode.invalidValue, 'lat, lon, and field are required.');
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum))
    throw new CustomFunctions.Error(CustomFunctions.ErrorCode.invalidValue, 'lat and lon must be numeric.');
  if (Math.abs(latNum) > 90 || Math.abs(lonNum) > 180)
    throw new CustomFunctions.Error(CustomFunctions.ErrorCode.invalidValue, 'Coordinate out of valid range.');

  const snap = Math.min(5000, Math.max(1, parseInt(snapFt, 10) || 100));
  const fieldStr = String(field).trim();

  try {
    const routeInfo = await _fetchRouteInfo(latNum, lonNum, snap);
    if (!routeInfo) return 'No match';
    const value = routeInfo[fieldStr];
    return (value !== undefined && value !== null) ? String(value) : 'No match';
  } catch (err) {
    throw new CustomFunctions.Error(
      CustomFunctions.ErrorCode.notAvailable,
      err?.name === 'AbortError' ? 'Request timed out.' : err.message
    );
  }
}

/**
 * Returns multiple KYTC roadway attributes, spilling right across columns.
 * @customfunction
 * @param {number} lat Latitude in decimal degrees (WGS84).
 * @param {number} lon Longitude in decimal degrees (WGS84).
 * @param {string} fields Comma-separated KYTC return keys, e.g. "County_Name,Route_Label,Milepoint".
 * @param {number} [snapFt=100] Snap distance in feet (1–5000). Default: 100.
 * @returns {Promise<string[][]>} A 1×N row of values that spills right.
 */
async function LRS_MULTI(lat, lon, fields, snapFt) {
  if (lat == null || lon == null || !fields)
    throw new CustomFunctions.Error(CustomFunctions.ErrorCode.invalidValue, 'lat, lon, and fields are required.');
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum))
    throw new CustomFunctions.Error(CustomFunctions.ErrorCode.invalidValue, 'lat and lon must be numeric.');

  const snap = Math.min(5000, Math.max(1, parseInt(snapFt, 10) || 100));
  const fieldList = String(fields).split(',').map(f => f.trim()).filter(Boolean);

  try {
    const routeInfo = await _fetchRouteInfo(latNum, lonNum, snap);
    if (!routeInfo) return [fieldList.map(() => 'No match')];
    return [fieldList.map(f => {
      const v = routeInfo[f];
      return (v !== undefined && v !== null) ? String(v) : '';
    })];
  } catch (err) {
    throw new CustomFunctions.Error(
      CustomFunctions.ErrorCode.notAvailable,
      err?.name === 'AbortError' ? 'Request timed out.' : err.message
    );
  }
}

/**
 * Returns the full KYTC field catalog as a 3-column spill: Key | Description | Coverage.
 * Coverage tiers: Always (100% complete), Recommended (>=85%), Situational (<85%).
 * @customfunction
 * @returns {Promise<string[][]>} Array of [Key, Description, Coverage] rows.
 */
async function FIELDS() {
  try {
    const response = await fetch(KYTC_KEYS_ENDPOINT);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return [['No fields returned', '', '']];
    const result = [['Key', 'Description', 'Coverage']];
    rows.forEach(row => {
      if (!row.Key) return;
      const pct = FIELD_COVERAGE[row.Key];
      const tier = pct === undefined ? 'Always' : (pct >= 85 ? 'Recommended' : 'Situational');
      result.push([String(row.Key), String(row.Description || ''), tier]);
    });
    return result;
  } catch (err) {
    throw new CustomFunctions.Error(CustomFunctions.ErrorCode.notAvailable, err.message);
  }
}

CustomFunctions.associate('LRS', LRS);
CustomFunctions.associate('LRS_MULTI', LRS_MULTI);
CustomFunctions.associate('FIELDS', FIELDS);

