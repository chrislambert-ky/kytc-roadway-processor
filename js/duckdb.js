/**
 * DuckDB-WASM wrapper module.
 *
 * Security note: Uses @duckdb/duckdb-wasm@1.30.0 loaded from jsDelivr CDN.
 * Version 1.29.2 was briefly compromised (CVE-2025-59037 / GHSA-w62p-hx95-gf2c);
 * version 1.30.0 is the officially patched release per DuckDB's security advisory.
 */

// Import DuckDB-WASM 1.30.0 (patched version) directly from jsDelivr CDN.
// NOTE: Version 1.29.2 was the compromised version; 1.30.0 is explicitly safe
// per the official DuckDB security advisory GHSA-w62p-hx95-gf2c.
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.30.0/+esm';

const DUCKDB_VERSION = '1.30.0';

export const CDN_BUNDLES = {
  mvp: {
    mainModule: `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist/duckdb-mvp.wasm`,
    mainWorker: `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist/duckdb-browser-mvp.worker.js`,
  },
  eh: {
    mainModule: `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist/duckdb-eh.wasm`,
    mainWorker: `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${DUCKDB_VERSION}/dist/duckdb-browser-eh.worker.js`,
  },
};

export class DuckDBWrapper {
  constructor() {
    this.db = null;
    this.conn = null;
    this._initialized = false;
    this.currentTable = 'user_data';
  }

  /**
   * Initialize DuckDB-WASM. Must be called before any other methods.
   */
  async init() {
    // Select the best bundle for this browser
    const bundle = await duckdb.selectBundle(CDN_BUNDLES);

    // Create an inline worker to avoid cross-origin restrictions
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );

    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger();
    this.db = new duckdb.AsyncDuckDB(logger, worker);
    await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    this.conn = await this.db.connect();
    this._initialized = true;
  }

  /**
   * Drop and recreate the main user table.
   */
  async _reset() {
    await this.conn.query(`DROP TABLE IF EXISTS user_data`);
    await this.conn.query(`DROP TABLE IF EXISTS kytc_attrs`);
    await this.conn.query(`DROP VIEW IF EXISTS final_data`);
  }

  /**
   * Load data from a File object into the user_data table.
   * Supports: CSV, JSON, Parquet, GeoJSON
   * @param {File} file
   * @param {string} format - 'csv'|'json'|'parquet'|'geojson'|'auto'
   * @returns {Promise<{rowCount: number, columns: Array}>}
   */
  async loadFile(file, format = 'auto') {
    await this._reset();

    const detectedFormat = format === 'auto' ? detectFormat(file.name) : format;

    if (detectedFormat === 'geojson') {
      return await this._loadGeoJSON(file);
    }

    // Register the file in DuckDB's virtual filesystem
    const filename = sanitizeFilename(file.name);
    await this.db.registerFileHandle(
      filename,
      file,
      4, // DuckDBDataProtocol.BROWSER_FILEREADER
      true
    );

    const sql = buildReadSQL(filename, detectedFormat, 'user_data');
    await this.conn.query(sql);

    return this._tableInfo();
  }

  /**
   * Load data from a URL into the user_data table.
   * @param {string} url
   * @param {string} format - 'csv'|'json'|'parquet'|'geojson'|'auto'
   * @returns {Promise<{rowCount: number, columns: Array}>}
   */
  async loadUrl(url, format = 'auto') {
    await this._reset();

    const filename = urlToFilename(url);
    const detectedFormat = format === 'auto' ? detectFormat(filename) : format;

    if (detectedFormat === 'geojson') {
      // Fetch and parse GeoJSON via JS since DuckDB spatial ext may not be available
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch URL: ${res.status} ${res.statusText}`);
      const geojson = await res.json();
      return await this._loadGeoJSONObject(geojson);
    }

    // Register URL in DuckDB virtual filesystem
    await this.db.registerFileURL(filename, url, 3 /* HTTP */, false);
    const sql = buildReadSQL(filename, detectedFormat, 'user_data');
    await this.conn.query(sql);

    return this._tableInfo();
  }

  /**
   * Parse and load a GeoJSON File into user_data.
   */
  async _loadGeoJSON(file) {
    const text = await file.text();
    const geojson = JSON.parse(text);
    return this._loadGeoJSONObject(geojson);
  }

  /**
   * Flatten a GeoJSON FeatureCollection into user_data rows.
   */
  async _loadGeoJSONObject(geojson) {
    if (!geojson || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      throw new Error('Invalid GeoJSON: expected a FeatureCollection with features array.');
    }

    const features = geojson.features;
    if (features.length === 0) {
      throw new Error('GeoJSON FeatureCollection contains no features.');
    }

    // Flatten features to rows: properties + extracted lat/lon from Point geometry
    const rows = features.map((f) => {
      const props = f.properties || {};
      const geom = f.geometry;
      let geojson_lat = null;
      let geojson_lon = null;
      if (geom && geom.type === 'Point' && Array.isArray(geom.coordinates)) {
        geojson_lon = geom.coordinates[0];
        geojson_lat = geom.coordinates[1];
      }
      return { _geojson_lon: geojson_lon, _geojson_lat: geojson_lat, ...props };
    });

    // Write to a temp JSON file in DuckDB's VFS
    const jsonStr = JSON.stringify(rows);
    await this.db.registerFileText('geojson_flat.json', jsonStr);
    await this.conn.query(
      `CREATE TABLE user_data AS
       SELECT row_number() OVER () AS _row_id, *
       FROM read_json_auto('geojson_flat.json')`
    );

    return this._tableInfo();
  }

  /**
   * Return basic info about the current user_data table.
   */
  async _tableInfo() {
    const columns = await this.getColumns();
    const rowCount = await this.getRowCount();
    return { rowCount, columns };
  }

  /**
   * Get column info for user_data.
   * @returns {Promise<Array<{name: string, type: string}>>}
   */
  async getColumns() {
    const desc = await this.conn.query(`DESCRIBE user_data`);
    return desc.toArray().map((row) => ({
      name: row.column_name,
      type: row.column_type,
    }));
  }

  /**
   * Get total row count of user_data.
   */
  async getRowCount() {
    const result = await this.conn.query(`SELECT COUNT(*) AS n FROM user_data`);
    const rows = result.toArray();
    return Number(rows[0].n);
  }

  /**
   * Get a page of rows from user_data.
   * @param {number} limit
   * @param {number} offset
   * @returns {Promise<object[]>}
   */
  async getData(limit = 50, offset = 0) {
    const result = await this.conn.query(
      `SELECT * FROM user_data LIMIT ${limit} OFFSET ${offset}`
    );
    return arrowToObjects(result);
  }

  /**
   * Get all rows (as plain objects) from user_data for processing.
   * @returns {Promise<object[]>}
   */
  async getAllRows() {
    const result = await this.conn.query(`SELECT * FROM user_data`);
    return arrowToObjects(result);
  }

  /**
   * Create the kytc_attrs table from an array of result objects.
   * @param {Array<{_row_id: number, ...attributes}>} results
   * @param {string[]} attributeKeys
   */
  async storeKytcResults(results, attributeKeys) {
    await this.conn.query(`DROP TABLE IF EXISTS kytc_attrs`);
    await this.conn.query(`DROP VIEW IF EXISTS final_data`);

    if (results.length === 0) return;

    // Write results as JSON and read into DuckDB
    const jsonStr = JSON.stringify(results);
    await this.db.registerFileText('kytc_results.json', jsonStr);

    await this.conn.query(
      `CREATE TABLE kytc_attrs AS SELECT * FROM read_json_auto('kytc_results.json')`
    );

    // Create the merged view
    const attrSelect = attributeKeys
      .map((k) => `k."${k}"`)
      .join(', ');

    await this.conn.query(`
      CREATE VIEW final_data AS
      SELECT u.*, ${attrSelect}
      FROM user_data u
      LEFT JOIN kytc_attrs k ON u._row_id = k._row_id
    `);
  }

  /**
   * Get a page from final_data view (after processing).
   */
  async getFinalData(limit = 50, offset = 0) {
    const result = await this.conn.query(
      `SELECT * FROM final_data LIMIT ${limit} OFFSET ${offset}`
    );
    return arrowToObjects(result);
  }

  /**
   * Get columns of final_data.
   */
  async getFinalColumns() {
    // DESCRIBE works for both tables and views
    const desc = await this.conn.query(`DESCRIBE final_data`);
    return desc.toArray().map((row) => ({
      name: row.column_name,
      type: row.column_type,
    }));
  }

  /**
   * Get total row count of final_data.
   */
  async getFinalRowCount() {
    const result = await this.conn.query(`SELECT COUNT(*) AS n FROM final_data`);
    const rows = result.toArray();
    return Number(rows[0].n);
  }

  /**
   * Execute an arbitrary SQL query and return results as objects.
   */
  async query(sql) {
    const result = await this.conn.query(sql);
    return arrowToObjects(result);
  }

  // ── Exports ──────────────────────────────────────────────────────────────

  /**
   * Export final_data (or user_data if no KYTC processing done) to CSV bytes.
   */
  async exportToCsv(tableName = 'final_data') {
    const tbl = await this._resolveExportTable(tableName);
    await this.conn.query(
      `COPY (SELECT * FROM ${tbl}) TO 'export.csv' (FORMAT CSV, HEADER TRUE)`
    );
    return this.db.copyFileToBuffer('export.csv');
  }

  /**
   * Export to JSON bytes.
   */
  async exportToJson(tableName = 'final_data') {
    const tbl = await this._resolveExportTable(tableName);
    await this.conn.query(
      `COPY (SELECT * FROM ${tbl}) TO 'export.json' (FORMAT JSON)`
    );
    return this.db.copyFileToBuffer('export.json');
  }

  /**
   * Export to Parquet bytes.
   */
  async exportToParquet(tableName = 'final_data') {
    const tbl = await this._resolveExportTable(tableName);
    await this.conn.query(
      `COPY (SELECT * FROM ${tbl}) TO 'export.parquet' (FORMAT PARQUET)`
    );
    return this.db.copyFileToBuffer('export.parquet');
  }

  /**
   * Fall back to user_data if final_data doesn't exist.
   */
  async _resolveExportTable(preferred) {
    try {
      await this.conn.query(`SELECT 1 FROM ${preferred} LIMIT 1`);
      return preferred;
    } catch {
      return 'user_data';
    }
  }

  async close() {
    if (this.conn) await this.conn.close();
    if (this.db) await this.db.terminate();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert an Apache Arrow Table to an array of plain JS objects. */
function arrowToObjects(arrowTable) {
  const schema = arrowTable.schema;
  return arrowTable.toArray().map((row) => {
    const obj = {};
    for (const field of schema.fields) {
      const val = row[field.name];
      // BigInt → number for JSON serialization compatibility
      obj[field.name] = typeof val === 'bigint' ? Number(val) : val;
    }
    return obj;
  });
}

/** Build the CREATE TABLE ... AS SELECT * FROM read_X() SQL, including a _row_id. */
function buildReadSQL(filename, format, tableName) {
  let readExpr;
  switch (format) {
    case 'csv':
      readExpr = `read_csv_auto('${filename}', header=true)`;
      break;
    case 'json':
      readExpr = `read_json_auto('${filename}')`;
      break;
    case 'parquet':
      readExpr = `read_parquet('${filename}')`;
      break;
    default:
      readExpr = `read_csv_auto('${filename}', header=true)`;
  }
  return `CREATE TABLE ${tableName} AS
          SELECT row_number() OVER () AS _row_id, *
          FROM ${readExpr}`;
}

/** Detect file format from filename extension. */
export function detectFormat(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  switch (ext) {
    case 'csv':
    case 'tsv':
      return 'csv';
    case 'json':
    case 'ndjson':
    case 'jsonl':
      return 'json';
    case 'parquet':
      return 'parquet';
    case 'geojson':
      return 'geojson';
    default:
      return 'csv';
  }
}

/** Sanitize a filename for use in DuckDB VFS (keep alphanumeric, dot, dash, underscore). */
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Extract a usable filename from a URL. */
function urlToFilename(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/');
    const last = parts[parts.length - 1] || 'data';
    return sanitizeFilename(last) || 'data.csv';
  } catch {
    return 'data.csv';
  }
}
