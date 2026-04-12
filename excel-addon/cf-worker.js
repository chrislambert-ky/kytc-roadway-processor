/**
 * Cloudflare Worker — KYTC API Proxy for Excel Add-in
 *
 * DEPLOY INSTRUCTIONS:
 *   1. Go to https://workers.cloudflare.com and sign in (free account works).
 *   2. Click "Create Application" → "Create Worker".
 *   3. Replace the default code with the contents of this file.
 *   4. Click "Deploy". Note the worker URL (e.g. kytc-proxy.yourname.workers.dev).
 *   5. Update PROXY_ENDPOINT in taskpane.html and functions.js to that URL.
 *
 * The worker forwards query-string parameters to the KYTC API and returns the
 * response with CORS headers that Excel Online accepts.
 */

const KYTC_BASE =
  'https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/route/GetRouteInfoByCoordinates';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    // Handle CORS pre-flight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Only allow GET
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    // Forward all query parameters to the KYTC API
    const incoming = new URL(request.url);
    const upstream = new URL(KYTC_BASE);
    upstream.search = incoming.search; // pass-through all params as-is

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstream.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'Upstream fetch failed', detail: err.message }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const body = await upstreamResponse.text();
    return new Response(body, {
      status: upstreamResponse.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  },
};
