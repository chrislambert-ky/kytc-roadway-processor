/**
 * KYTC Spatial API service module.
 * Endpoint: https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app
 * The API accepts GPS coordinates and returns LRS (Linear Referencing System)
 * roadway attributes for the nearest Kentucky roadway segment.
 */

export const KYTC_BASE_URL =
  'https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api';

/** All available KYTC roadway attributes. */
export const AVAILABLE_ATTRIBUTES = [
  {
    key: 'County_Name',
    label: 'County Name',
    description: 'County in which the roadway segment is located.',
    category: 'Location',
  },
  {
    key: 'Road_Name',
    label: 'Road Name',
    description: 'Name of the road or street.',
    category: 'Location',
  },
  {
    key: 'Route',
    label: 'Route',
    description: 'Route number designation.',
    category: 'Location',
  },
  {
    key: 'Route_Type',
    label: 'Route Type',
    description: 'Route type classification (e.g., Interstate, US, KY).',
    category: 'Location',
  },
  {
    key: 'Route_Unique_Identifier',
    label: 'Route ID',
    description: 'Unique route identifier used in the LRS.',
    category: 'Location',
  },
  {
    key: 'Milepoint',
    label: 'Milepoint',
    description: 'Milepoint along the route at the snapped location.',
    category: 'Location',
  },
  {
    key: 'Direction',
    label: 'Direction',
    description: 'Cardinal direction of the route (N, S, E, W).',
    category: 'Location',
  },
  {
    key: 'Cardinality',
    label: 'Cardinality',
    description: 'Direction of travel relative to the route direction.',
    category: 'Location',
  },
  {
    key: 'Government_Level',
    label: 'Government Level',
    description: 'Governmental jurisdiction (State, Federal, Local, etc.).',
    category: 'Classification',
  },
  {
    key: 'Type_Operation',
    label: 'Type of Operation',
    description: 'Operational type of the roadway.',
    category: 'Classification',
  },
  {
    key: 'Speed_Limit_Posted_MPH',
    label: 'Speed Limit (mph)',
    description: 'Posted speed limit in miles per hour.',
    category: 'Characteristics',
  },
  {
    key: 'Lane_Width_Feet',
    label: 'Lane Width (ft)',
    description: 'Width of each lane in feet.',
    category: 'Characteristics',
  },
  {
    key: 'Median_Type',
    label: 'Median Type',
    description: 'Type of median (e.g., Raised Curb, Painted, None).',
    category: 'Characteristics',
  },
  {
    key: 'Median_Width_Feet',
    label: 'Median Width (ft)',
    description: 'Width of the median in feet.',
    category: 'Characteristics',
  },
  {
    key: 'Grade_Percent',
    label: 'Grade (%)',
    description: 'Road grade as a percentage.',
    category: 'Characteristics',
  },
  {
    key: 'Traffic_Last_Count',
    label: 'Traffic Count (AADT)',
    description: 'Most recent annual average daily traffic count.',
    category: 'Traffic',
  },
  {
    key: 'Truck_Weight_Limit_Class',
    label: 'Truck Weight Class',
    description: 'Truck weight limit classification.',
    category: 'Traffic',
  },
  {
    key: 'Geometry',
    label: 'Geometry',
    description: 'Snapped point geometry (WKT format).',
    category: 'Geometry',
  },
];

export const ATTRIBUTE_CATEGORIES = [
  'Location',
  'Classification',
  'Characteristics',
  'Traffic',
  'Geometry',
];

/**
 * Call the KYTC API to get roadway attributes for a single lat/lon coordinate.
 * @param {number} lat - Latitude (WGS84)
 * @param {number} lon - Longitude (WGS84)
 * @param {string[]} selectedKeys - List of attribute keys to return
 * @param {object} options
 * @param {number} [options.snapDistance=100] - Snap distance in feet
 * @param {boolean} [options.returnMultiple=false] - Return multiple routes
 * @param {string|number} [options.requestId] - Optional request identifier
 * @returns {Promise<object|null>} Route info object or null if not found
 */
export async function fetchRouteInfo(lat, lon, selectedKeys, options = {}) {
  const {
    snapDistance = 100,
    returnMultiple = false,
    requestId = undefined,
  } = options;

  const params = new URLSearchParams({
    xcoord: lon,
    ycoord: lat,
    snap_distance: snapDistance,
    return_multiple: returnMultiple,
    return_m: true,
    return_keys: selectedKeys.join(', '),
    return_format: 'json',
    input_epsg: 4326,
    output_epsg: 4326,
  });

  if (requestId !== undefined && requestId !== null) {
    params.append('request_id', requestId);
  }

  const url = `${KYTC_BASE_URL}/route/GetRouteInfoByCoordinates?${params}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`KYTC API HTTP error ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();

  if (data && data.Route_Info) {
    return data.Route_Info;
  }

  // API returned a message (e.g., no route found within snap distance)
  return null;
}

/**
 * Process an array of coordinate rows through the KYTC API.
 * @param {Array<{lat: number, lon: number, rowId: number}>} rows
 * @param {string[]} selectedKeys
 * @param {object} options - API and processing options
 * @param {Function} onProgress - Called with ({done, total, rowId, result, error})
 * @param {AbortSignal} signal - Optional AbortSignal to cancel processing
 * @returns {Promise<Map<number, object|null>>} Map of rowId → result
 */
export async function processRows(rows, selectedKeys, options, onProgress, signal) {
  const {
    snapDistance = 100,
    returnMultiple = false,
    delayMs = 50,
  } = options;

  const results = new Map();
  const total = rows.length;

  for (let i = 0; i < rows.length; i++) {
    if (signal && signal.aborted) break;

    const { lat, lon, rowId } = rows[i];

    // Skip rows with missing or invalid coordinates
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
      results.set(rowId, null);
      onProgress({ done: i + 1, total, rowId, result: null, error: 'Missing coordinates' });
      continue;
    }

    try {
      const result = await fetchRouteInfo(lat, lon, selectedKeys, {
        snapDistance,
        returnMultiple,
        requestId: rowId,
      });
      results.set(rowId, result);
      onProgress({ done: i + 1, total, rowId, result, error: null });
    } catch (err) {
      results.set(rowId, null);
      onProgress({ done: i + 1, total, rowId, result: null, error: err.message });
    }

    // Small delay to avoid overwhelming the API
    if (delayMs > 0 && i < rows.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
