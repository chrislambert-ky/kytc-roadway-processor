// Browser JavaScript translation of `code-example-sync.txt` and `code-example-async.txt`
// for the KYTC `GetRouteInfoByCoordinates` endpoint.

const KYTC_ENDPOINT = 'https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/route/GetRouteInfoByCoordinates';

function buildCoordinateRequestUrl({ xcoord, ycoord, requestId, returnKeys = '', snapDistance = 200 }) {
  const url = new URL(KYTC_ENDPOINT);
  url.search = new URLSearchParams({
    xcoord: String(xcoord),
    ycoord: String(ycoord),
    snap_distance: String(snapDistance),
    request_id: String(requestId),
    ...(returnKeys ? { return_keys: returnKeys } : {}),
  }).toString();
  return url.toString();
}

async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API ${response.status}: ${text.slice(0, 140)}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Mirrors the Python sync example: one request at a time.
async function snapPointsSync(rows, options = {}) {
  const results = [];
  const returnKeys = options.returnKeys || '';

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const url = buildCoordinateRequestUrl({
      xcoord: row.longitude,
      ycoord: row.latitude,
      requestId: row.requestId ?? index,
      returnKeys,
      snapDistance: options.snapDistance ?? 200,
    });

    const payload = await fetchWithTimeout(url, options.timeoutMs ?? 10000);
    if (payload?.Route_Info) {
      results.push({
        ...payload.Route_Info,
        Request_Id: payload.Request_Id ?? row.requestId ?? index,
      });
    }
  }

  return results;
}

// Mirrors the Python async example: controlled parallel requests with retries.
async function snapPointsAsync(rows, options = {}) {
  const concurrency = options.concurrency ?? 10;
  const returnKeys = options.returnKeys || '';
  const output = [];

  for (let start = 0; start < rows.length; start += concurrency) {
    const batch = rows.slice(start, start + concurrency);
    const batchResults = await Promise.all(batch.map(async (row, batchIndex) => {
      const requestId = row.requestId ?? start + batchIndex;
      const url = buildCoordinateRequestUrl({
        xcoord: row.longitude,
        ycoord: row.latitude,
        requestId,
        returnKeys,
        snapDistance: options.snapDistance ?? 200,
      });

      let lastError = null;
      const retries = options.retries ?? 2;

      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const payload = await fetchWithTimeout(url, options.timeoutMs ?? 10000);
          return payload?.Route_Info
            ? { ...payload.Route_Info, Request_Id: payload.Request_Id ?? requestId }
            : {};
        } catch (error) {
          lastError = error;
          if (attempt < retries) {
            await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
          }
        }
      }

      return { Request_Id: requestId, Error: lastError?.message || 'Request failed' };
    }));

    output.push(...batchResults);
  }

  return output;
}

if (typeof window !== 'undefined') {
  window.KytcBrowserExamples = {
    buildCoordinateRequestUrl,
    snapPointsSync,
    snapPointsAsync,
  };
}
