/* global CustomFunctions */

/**
 * KYTC Roadway Attribute — Excel Custom Functions
 *
 * Returns roadway attributes from the KYTC Spatial API for a given coordinate.
 *
 * Usage (in a cell):
 *   =KYTC.GEO(A1, B1, "County_Name")
 *   =KYTC.GEO(A1, B1, "Route_Label")
 *   =KYTC.GEO(A1, B1, "Milepoint", 200)
 *
 * NOTE: Excel custom functions run in a browser-based JS sandbox and use fetch().
 * The KYTC API must return an appropriate Access-Control-Allow-Origin header for
 * cross-origin requests to succeed. If CORS is blocked, a lightweight proxy will
 * be needed. Verify CORS before deploying: see README for testing instructions.
 */

const KYTC_ENDPOINT =
  'https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/route/GetRouteInfoByCoordinates';
const KYTC_KEYS_ENDPOINT =
  'https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/utilities/GetReturnKeyInfo'
  + '?service=GetRouteInfoByCoordinates';

/**
 * Returns a single KYTC roadway attribute for a coordinate pair.
 * @customfunction
 * @param {number} lat    Latitude in decimal degrees (WGS84). Typically 36.5–39.1 for Kentucky.
 * @param {number} lon    Longitude in decimal degrees (WGS84). Typically -89.6 to -82.0 for Kentucky.
 * @param {string} field  The KYTC return key to retrieve, e.g. "County_Name".
 * @param {number} [snapFt=100]  Snap distance in feet (1–5000). Default: 100.
 * @returns {Promise<string>} The field value, or an error string.
 */
async function GEO(lat, lon, field, snapFt) {
  // ── Input validation ──────────────────────────────────────────────────
  if (lat == null || lon == null || !field) {
    throw new CustomFunctions.Error(
      CustomFunctions.ErrorCode.invalidValue,
      'lat, lon, and field are required.'
    );
  }

  const latNum = Number(lat);
  const lonNum = Number(lon);

  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    throw new CustomFunctions.Error(
      CustomFunctions.ErrorCode.invalidValue,
      'lat and lon must be numeric.'
    );
  }
  if (Math.abs(latNum) > 90 || Math.abs(lonNum) > 180) {
    throw new CustomFunctions.Error(
      CustomFunctions.ErrorCode.invalidValue,
      'Coordinate out of valid range.'
    );
  }

  const snap = Math.min(5000, Math.max(1, parseInt(snapFt, 10) || 100));
  const fieldStr = String(field).trim();

  // ── Build request URL ─────────────────────────────────────────────────
  const url = new URL(KYTC_ENDPOINT);
  url.search = new URLSearchParams({
    xcoord: String(lonNum),
    ycoord: String(latNum),
    snap_distance: String(snap),
    return_keys: fieldStr,
    return_format: 'json',
    input_epsg: '4326',
    output_epsg: '4326',
    request_id: 'excel-1',
  }).toString();

  // ── Fetch ─────────────────────────────────────────────────────────────
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);

    if (!response.ok) {
      throw new CustomFunctions.Error(
        CustomFunctions.ErrorCode.notAvailable,
        `API returned HTTP ${response.status}`
      );
    }

    const data = await response.json();
    const routeInfo = data?.Route_Info?.[0];

    if (!routeInfo) {
      return 'No match';
    }

    const value = routeInfo[fieldStr];
    return (value !== undefined && value !== null) ? String(value) : 'No match';

  } catch (err) {
    clearTimeout(timer);
    if (err instanceof CustomFunctions.Error) throw err;
    const isTimeout = err?.name === 'AbortError';
    throw new CustomFunctions.Error(
      CustomFunctions.ErrorCode.notAvailable,
      isTimeout ? 'Request timed out after 10 seconds.' : err.message
    );
  }
}

/**
 * Returns the list of available KYTC return keys as a two-column array [Key, Description].
 * Paste this function into one cell and let the result spill downward.
 * @customfunction
 * @returns {Promise<string[][]>} Array of [Key, Description] rows.
 */
async function FIELDS() {
  try {
    const response = await fetch(KYTC_KEYS_ENDPOINT);

    if (!response.ok) {
      throw new CustomFunctions.Error(
        CustomFunctions.ErrorCode.notAvailable,
        `API returned HTTP ${response.status}`
      );
    }

    const rows = await response.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return [['No fields returned', '']];
    }

    const result = [['Key', 'Description']];
    rows.forEach((row) => {
      if (row.Key) result.push([String(row.Key), String(row.Description || '')]);
    });

    return result;

  } catch (err) {
    if (err instanceof CustomFunctions.Error) throw err;
    throw new CustomFunctions.Error(
      CustomFunctions.ErrorCode.notAvailable,
      err.message
    );
  }
}

// Register functions with the Excel runtime
CustomFunctions.associate('GEO', GEO);
CustomFunctions.associate('FIELDS', FIELDS);
