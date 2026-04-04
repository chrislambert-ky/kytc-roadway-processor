import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

const KYTC_ENDPOINT = 'https://kytc-api-v100-lts-qrntk7e3ra-uc.a.run.app/api/route/GetRouteInfoByCoordinates';
const DEFAULT_ATTRIBUTES = [
  'District_Number',
  'County_Name',
  'Route_Label',
  'Road_Name',
  'Cardinality',
  'Direction',
  'Milepoint',
  'Snap_Distance_Feet',
  'Snap_Probability'
];
const ACTIVE_EXPORT_FORMATS = new Set(['csv', 'json', 'geojson', 'kml', 'parquet', 'geoparquet', 'xlsx']);

const state = {
  currentStep: 1,
  originalRows: [],
  workingRows: [],
  headerMap: [],
  originalColumnOrder: [],
  attributes: [],
  selectedAttributes: new Set(DEFAULT_ATTRIBUTES),
  processedKeys: new Set(),
  tables: {
    load: null,
    review: null,
    export: null,
  },
  isProcessing: false,
  selectedColumns: new Set(),
  selectedExportFormat: 'csv',
  lastProcessedAt: null,
  logLines: [],
  db: null,
  conn: null,
  dbReady: false,
  coordinateMode: 'separate',
  wktColumn: null,
  wktDerivedCols: { lat: null, lon: null },
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindWorkflowEvents();
  bindUploadEvents();
  bindAttributeEvents();
  bindActionEvents();
  bindExportEvents();
  populateCoordinateSelectors([]);
  renderDefaultAttributeList();
  await loadAttributeCatalog();
  updateSelectionSummary();
  clearProcessConsole();
  setProcessorIndicator('ready', 'KYTC API');
  setDuckDbIndicator('loading', 'DuckDB');
  renderLoadPreviewTable([]);
  renderReviewTable();
  renderExportSummary();
  goToStep(1, { force: true });
  updateUIState();

  // Initialize DuckDB in background — don't block UI startup
  initDuckDB();
}

function bindWorkflowEvents() {
  document.querySelectorAll('.workflow-tab').forEach(button => {
    button.addEventListener('click', () => goToStep(Number(button.dataset.step)));
  });
  // Prevent info icon clicks from triggering the tab
  document.querySelectorAll('.tab-info-btn').forEach(el => {
    el.addEventListener('click', e => e.stopPropagation());
  });
  // Initialize Bootstrap tooltips on the info icons
  document.querySelectorAll('.tab-info-btn[data-bs-toggle="tooltip"]').forEach(el => {
    new bootstrap.Tooltip(el, { trigger: 'hover focus', container: 'body' });
  });
  document.getElementById('backStepBtn')?.addEventListener('click', () => goToStep(state.currentStep - 1));
  document.getElementById('nextStepBtn')?.addEventListener('click', () => goToStep(state.currentStep + 1));
}

function bindUploadEvents() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  dropZone.addEventListener('click', (event) => {
    if (event.target.closest('#clearFileBtn')) return;
    fileInput.click();
  });
  dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') fileInput.click();
  });
  fileInput.addEventListener('change', (event) => {
    const [file] = event.target.files || [];
    if (file) handleFile(file);
  });

  document.getElementById('clearFileBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    clearFile();
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', (event) => {
    const [file] = event.dataTransfer?.files || [];
    if (file) {
      fileInput.files = event.dataTransfer.files;
      handleFile(file);
    }
  });
}

function bindAttributeEvents() {
  document.getElementById('attributeSearch')?.addEventListener('input', (event) => {
    renderAttributeTable(event.target.value);
  });

  document.getElementById('attributeTableBody')?.addEventListener('change', (event) => {
    if (!event.target.matches('.attr-checkbox') || event.target.disabled) return;
    const key = event.target.value;
    if (event.target.checked) {
      state.selectedAttributes.add(key);
    } else {
      state.selectedAttributes.delete(key);
    }
    updateSelectionSummary();
    renderReviewTable();
    renderExportSummary();
    updateUIState();
  });

  document.getElementById('defaultsBtn')?.addEventListener('click', () => {
    state.selectedAttributes = new Set(DEFAULT_ATTRIBUTES);
    renderAttributeTable(document.getElementById('attributeSearch').value);
    updateSelectionSummary();
    renderReviewTable();
    renderExportSummary();
    updateUIState();
  });

  document.getElementById('selectAllBtn')?.addEventListener('click', () => {
    state.selectedAttributes = new Set(state.attributes.map(attribute => attribute.key));
    renderAttributeTable(document.getElementById('attributeSearch').value);
    updateSelectionSummary();
    renderReviewTable();
    renderExportSummary();
    updateUIState();
  });

  document.getElementById('clearAllBtn')?.addEventListener('click', () => {
    state.selectedAttributes = new Set(DEFAULT_ATTRIBUTES);
    renderAttributeTable(document.getElementById('attributeSearch').value);
    updateSelectionSummary();
    renderReviewTable();
    renderExportSummary();
    updateUIState();
  });
}

function bindActionEvents() {
  document.getElementById('latSelect')?.addEventListener('change', () => {
    refreshColumnLocks();
    renderLoadPreviewTable(state.workingRows, state.workingRows.length ? 'Spreadsheet preview' : 'No file loaded');
    renderReviewTable();
    updateUIState();
  });

  document.getElementById('lonSelect')?.addEventListener('change', () => {
    refreshColumnLocks();
    renderLoadPreviewTable(state.workingRows, state.workingRows.length ? 'Spreadsheet preview' : 'No file loaded');
    renderReviewTable();
    updateUIState();
  });

  document.querySelectorAll('input[name="coordMode"]').forEach(radio => {
    radio.addEventListener('change', (event) => {
      if (event.target.checked) switchCoordinateMode(event.target.value);
    });
  });

  document.getElementById('wktSelect')?.addEventListener('change', (event) => {
    if (state.coordinateMode === 'wkt' || state.coordinateMode === 'other') {
      applyWktColumn(event.target.value, state.coordinateMode === 'other');
    }
  });

  document.getElementById('colSelectAll')?.addEventListener('click', () => {
    state.selectedColumns = new Set(state.originalColumnOrder);
    renderColumnSelector(state.headerMap);
    updateLoadTableColumns();
  });

  document.getElementById('colUnselectAll')?.addEventListener('click', () => {
    const lat = document.getElementById('latSelect')?.value;
    const lon = document.getElementById('lonSelect')?.value;
    state.selectedColumns = new Set([lat, lon].filter(Boolean));
    renderColumnSelector(state.headerMap);
    updateLoadTableColumns();
  });

  document.getElementById('headerChips')?.addEventListener('click', (event) => {
    const chip = event.target.closest('.col-chip[data-col]');
    if (!chip || chip.dataset.locked === 'true') return;
    const col = chip.dataset.col;
    if (state.selectedColumns.has(col)) {
      state.selectedColumns.delete(col);
    } else {
      state.selectedColumns.add(col);
    }
    chip.classList.toggle('is-selected', state.selectedColumns.has(col));
    updateLoadTableColumns();
  });

  document.getElementById('processBtn')?.addEventListener('click', processCsv);
}

function bindExportEvents() {
  document.querySelectorAll('input[name="exportFormat"]').forEach(input => {
    input.addEventListener('change', (event) => {
      state.selectedExportFormat = event.target.value;
      updateExportOptionStyles();
    });
  });

  // Per-format download buttons — stopPropagation so the radio doesn't toggle
  document.querySelectorAll('.export-dl-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const format = btn.dataset.format;
      try {
        await downloadFormat(format);
      } catch (error) {
        updateStatus(error.message || 'Download failed.', 'danger');
        logProcessConsole(`Export error: ${error.message}`);
      }
    });
  });

  updateExportOptionStyles();
}

async function loadAttributeCatalog() {
  try {
    const response = await fetch('kytc_route_api_keys.csv', { cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const csvText = await response.text();
    const rows = parseCSV(csvText);

    state.attributes = rows
      .filter(row => row.KEY)
      .map(row => ({
        key: String(row.KEY).trim(),
        alias: String(row.ALIAS || '').trim(),
        description: String(row.DESCRIPTION || '').trim(),
      }))
      .sort((left, right) => {
        const leftDefault = DEFAULT_ATTRIBUTES.includes(left.key) ? 0 : 1;
        const rightDefault = DEFAULT_ATTRIBUTES.includes(right.key) ? 0 : 1;
        if (leftDefault !== rightDefault) return leftDefault - rightDefault;
        return left.key.localeCompare(right.key);
      });

    renderDefaultAttributeList();
    renderAttributeTable();
  } catch (error) {
    state.attributes = DEFAULT_ATTRIBUTES
      .slice()
      .sort((left, right) => left.localeCompare(right))
      .map(key => ({
        key,
        alias: key.replace(/_/g, ' '),
        description: 'Quick default roadway field.',
      }));

    renderDefaultAttributeList();
    renderAttributeTable();
    updateStatus('The full attribute list could not be loaded, but the locked defaults are ready.', 'warning');
  }
}

async function initDuckDB() {
  try {
    setDuckDbIndicator('loading', 'DuckDB');
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
    );
    const worker = new Worker(workerUrl);
    state.db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await state.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    state.conn = await state.db.connect();
    state.dbReady = true;
    setDuckDbIndicator('ready', 'DuckDB');
    logProcessConsole('DuckDB-WASM initialized. Files will load via DuckDB.');
  } catch (error) {
    state.dbReady = false;
    setDuckDbIndicator('error', 'DuckDB');
    logProcessConsole(`DuckDB-WASM failed to initialize (${error.message}). File loading is unavailable.`);
    updateStatus('DuckDB could not be loaded. File loading is unavailable — try refreshing the page.', 'danger');
  }
}

function clearFile() {
  state.originalRows = [];
  state.workingRows = [];
  state.headerMap = [];
  state.originalColumnOrder = [];
  state.selectedColumns = new Set();
  state.processedKeys = new Set();
  state.lastProcessedAt = null;
  state.coordinateMode = 'separate';
  state.wktColumn = null;
  state.wktDerivedCols = { lat: null, lon: null };

  const coordModeSeparate = document.getElementById('coordModeSeparate');
  if (coordModeSeparate) coordModeSeparate.checked = true;
  document.getElementById('coordSeparateFields')?.classList.remove('d-none');
  document.getElementById('coordWktFields')?.classList.add('d-none');
  document.getElementById('wktParseStatus')?.classList.add('d-none');

  const dropZone = document.getElementById('dropZone');
  dropZone.classList.remove('has-file');
  dropZone.querySelector('.drop-zone-text').textContent = 'Click to browse or drag & drop a file here';
  dropZone.querySelector('.drop-zone-subtext').textContent = 'The file stays in your browser until you process it.';

  const fileInput = document.getElementById('fileInput');
  fileInput.value = '';

  document.getElementById('fileStatus').textContent = 'No file loaded yet.';
  document.getElementById('columnCount').textContent = '0 columns';

  renderColumnSelector([]);
  renderLoadPreviewTable([]);
  renderReviewTable();
  renderExportSummary();
  updateStatus('File unloaded.', 'secondary');
  updateUIState();
}

async function handleFile(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  const validExts = ['csv', 'json', 'geojson', 'parquet'];
  if (!validExts.includes(ext)) {
    updateStatus('Please upload a CSV, JSON, GeoJSON, or Parquet file.', 'danger');
    return;
  }

  updateStatus('Reading file…', 'info');

  try {
    const { rows, loadedVia } = await loadFileByFormat(file, ext);

    if (!rows.length) {
      throw new Error('No data rows were found in the file.');
    }

    const sourceHeaders = Object.keys(rows[0]);
    const headerMap = normalizeHeaderMap(sourceHeaders);
    const normalizedRows = rows.map(row => normalizeRow(row, headerMap));

    state.originalRows = rows;
    state.workingRows = normalizedRows;
    state.headerMap = headerMap;
    state.originalColumnOrder = headerMap.map(item => item.normalized);
    state.selectedColumns = new Set(state.originalColumnOrder);
    state.processedKeys = new Set();
    state.lastProcessedAt = null;

    const dropZone = document.getElementById('dropZone');
    dropZone.classList.add('has-file');
    dropZone.querySelector('.drop-zone-text').textContent = file.name;
    dropZone.querySelector('.drop-zone-subtext').textContent = `${rows.length.toLocaleString()} rows ready for review`;

    document.getElementById('fileStatus').textContent = `${file.name} loaded · ${rows.length.toLocaleString()} rows`;
    document.getElementById('columnCount').textContent = `${headerMap.length} columns`;

    renderColumnSelector(headerMap);
    populateCoordinateSelectors(state.originalColumnOrder);
    clearProcessConsole();
    logProcessConsole(`Loaded ${file.name} with ${rows.length.toLocaleString()} row(s) via ${loadedVia}.`);
    if (headerMap.some(item => item.original !== item.normalized)) {
      logProcessConsole('Normalized one or more headers by trimming spaces and replacing spaces with underscores.');
    }

    renderLoadPreviewTable(normalizedRows, 'Spreadsheet preview');
    renderReviewTable();
    renderExportSummary();
    updateStatus(`Loaded ${rows.length.toLocaleString()} rows. Confirm the latitude and longitude columns, then continue.`, 'success');
    goToStep(1, { force: true });
    updateUIState();
  } catch (error) {
    state.originalRows = [];
    state.workingRows = [];
    state.headerMap = [];
    state.originalColumnOrder = [];
    state.processedKeys = new Set();
    state.lastProcessedAt = null;
    renderLoadPreviewTable([]);
    renderReviewTable();
    renderExportSummary();
    updateStatus(error.message || 'The file could not be read.', 'danger');
    updateUIState();
  }
}

async function loadFileByFormat(file, ext) {
  if (ext === 'csv') return loadCsvFile(file);
  if (ext === 'json') return loadJsonFile(file);
  if (ext === 'geojson') return loadGeoJsonFile(file);
  if (ext === 'parquet') return loadParquetFile(file);
  throw new Error(`Unsupported format: .${ext}`);
}

async function loadCsvFile(file) {
  if (!state.dbReady) {
    throw new Error('DuckDB is not available. Try refreshing the page.');
  }
  const buffer = await file.arrayBuffer();
  await state.db.registerFileBuffer('input_data.csv', new Uint8Array(buffer));
  const result = await state.conn.query(
    `SELECT * FROM read_csv_auto('input_data.csv', header=true, sample_size=-1, all_varchar=true)`
  );
  const fieldNames = result.schema.fields.map(f => f.name);
  const rows = result.toArray().map(arrowRow => {
    const obj = {};
    fieldNames.forEach(name => {
      const val = arrowRow[name];
      obj[name] = val == null ? '' : String(val);
    });
    return obj;
  });
  return { rows, loadedVia: 'DuckDB-WASM' };
}

async function loadJsonFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The file could not be parsed as JSON. Make sure it is a valid JSON array of objects.');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('JSON import expects an array of objects at the top level.');
  }
  if (!parsed.length) {
    throw new Error('The JSON array is empty.');
  }
  const rows = parsed.map(item => {
    const row = {};
    Object.entries(item || {}).forEach(([key, val]) => {
      row[key] = val == null ? '' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
    });
    return row;
  });
  return { rows, loadedVia: 'JSON parser' };
}

async function loadGeoJsonFile(file) {
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The file could not be parsed as GeoJSON. Make sure it is valid JSON.');
  }
  let features;
  if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    features = parsed.features;
  } else if (parsed.type === 'Feature') {
    features = [parsed];
  } else {
    throw new Error('GeoJSON import expects a FeatureCollection or Feature at the top level.');
  }
  if (!features.length) {
    throw new Error('The GeoJSON file contains no features.');
  }
  const rows = features.map(feature => {
    const props = feature.properties ? { ...feature.properties } : {};
    // Extract coordinates from Point geometry if lat/lon are not already in properties
    if (feature.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)) {
      const [lon, lat] = feature.geometry.coordinates;
      const hasLon = ['longitude', 'lon', 'lng', 'x', 'xcoord'].some(k => k in props);
      const hasLat = ['latitude', 'lat', 'y', 'ycoord'].some(k => k in props);
      if (!hasLon) props.longitude = lon != null ? String(lon) : '';
      if (!hasLat) props.latitude = lat != null ? String(lat) : '';
    }
    const row = {};
    Object.entries(props).forEach(([key, val]) => {
      row[key] = val == null ? '' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
    });
    return row;
  });
  return { rows, loadedVia: 'GeoJSON parser' };
}

async function loadParquetFile(file) {
  if (!state.dbReady) {
    throw new Error('DuckDB is not available. Try refreshing the page.');
  }
  const buffer = await file.arrayBuffer();
  await state.db.registerFileBuffer('input_data.parquet', new Uint8Array(buffer));
  try {
    // Introspect schema so date/timestamp columns are cast to text at the SQL level,
    // avoiding Arrow BigInt or Date objects reaching JS.
    const desc = await state.conn.query(`DESCRIBE SELECT * FROM read_parquet('input_data.parquet')`);
    const colExprs = desc.toArray().map(r => {
      const name = String(r.column_name);
      const type = String(r.column_type).toUpperCase();
      const q = `"${name.replace(/"/g, '""')}"`;
      const isDateTime = type === 'DATE' || type === 'TIME' ||
                         type.startsWith('TIMESTAMP') || type.startsWith('INTERVAL');
      return isDateTime ? `CAST(${q} AS VARCHAR) AS ${q}` : q;
    });
    const result = await state.conn.query(
      `SELECT ${colExprs.join(', ')} FROM read_parquet('input_data.parquet')`
    );
    const fieldNames = result.schema.fields.map(f => f.name);
    const rows = result.toArray().map(arrowRow => {
      const obj = {};
      fieldNames.forEach(name => {
        const val = arrowRow[name];
        if (val == null) {
          obj[name] = '';
        } else if (typeof val === 'bigint') {
          // Fallback for any BigInt not caught by the CAST above (Timestamp[us])
          const ms = Number(val / 1000n);
          const d = new Date(ms);
          if (!isNaN(d.getTime())) {
            const p = n => String(n).padStart(2, '0');
            obj[name] = `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
          } else {
            obj[name] = String(val);
          }
        } else {
          obj[name] = String(val);
        }
      });
      return obj;
    });
    return { rows, loadedVia: 'DuckDB-WASM (Parquet)' };
  } finally {
    await state.db.dropFile('input_data.parquet').catch(() => {});
  }
}

function renderColumnSelector(headerMap) {
  const container = document.getElementById('headerChips');
  const notice = document.getElementById('headerNotice');
  if (!container) return;

  if (!headerMap || !headerMap.length) {
    container.innerHTML = '<span class="text-secondary small">Upload a file to see columns.</span>';
    if (notice) notice.classList.add('d-none');
    return;
  }

  const lat = document.getElementById('latSelect')?.value;
  const lon = document.getElementById('lonSelect')?.value;

  container.innerHTML = headerMap.map(item => {
    const col = item.normalized;
    const locked = col === lat || col === lon;
    const selected = locked || state.selectedColumns.has(col);
    const changed = item.original !== item.normalized;
    const lockedAttr = locked ? 'data-locked="true"' : '';
    const lockedIcon = locked ? '<i class="bi bi-lock-fill col-chip-lock"></i>' : '';
    const classes = ['col-chip', selected ? 'is-selected' : '', locked ? 'is-locked' : ''].filter(Boolean).join(' ');
    return `<span class="${classes}" data-col="${escapeAttribute(col)}" ${lockedAttr} title="${changed ? `Normalized from: ${escapeHtml(item.original)}` : escapeHtml(col)}">${escapeHtml(col)}${lockedIcon}</span>`;
  }).join('');

  // Normalize notice
  if (notice) {
    const changed = headerMap.filter(item => item.original !== item.normalized);
    if (!changed.length) {
      notice.classList.add('d-none');
    } else {
      notice.classList.remove('d-none');
      const preview = changed.slice(0, 5).map(item => `${item.original} → ${item.normalized}`).join(' · ');
      notice.innerHTML = `<i class="bi bi-info-circle me-1"></i><strong>Headers normalized:</strong> ${escapeHtml(preview)}${changed.length > 5 ? ` +${changed.length - 5} more` : ''}`;
    }
  }
}

function refreshColumnLocks() {
  renderColumnSelector(state.headerMap);
  // Ensure locked columns are always in selectedColumns
  const lat = document.getElementById('latSelect')?.value;
  const lon = document.getElementById('lonSelect')?.value;
  if (lat) state.selectedColumns.add(lat);
  if (lon) state.selectedColumns.add(lon);
}

function renderHeaderChips(headerMap) {
  const container = document.getElementById('headerChips');
  if (!container) return;

  if (!headerMap.length) {
    container.className = 'header-chip-list empty-state';
    container.textContent = 'Upload a file to view your columns.';
    return;
  }

  container.className = 'header-chip-list';
  container.innerHTML = headerMap.map(item => {
    const changed = item.original !== item.normalized;
    return `
      <span class="header-chip">
        <span>${escapeHtml(item.normalized)}</span>
        ${changed ? `<span class="original-name">from ${escapeHtml(item.original)}</span>` : ''}
      </span>
    `;
  }).join('');
}

function renderHeaderNotice(headerMap) {
  const note = document.getElementById('headerNotice');
  if (!note) return;

  const changed = headerMap.filter(item => item.original !== item.normalized);
  if (!changed.length) {
    note.classList.add('d-none');
    note.textContent = '';
    return;
  }

  const preview = changed
    .slice(0, 6)
    .map(item => `${item.original} → ${item.normalized}`)
    .join(' · ');

  note.classList.remove('d-none');
  note.innerHTML = `<strong>Headers normalized:</strong> ${escapeHtml(preview)}${changed.length > 6 ? ' …' : ''}`;
}

function renderDefaultAttributeList() {
  const container = document.getElementById('defaultAttributeList');
  if (!container) return;

  const keys = DEFAULT_ATTRIBUTES.slice().sort((left, right) => left.localeCompare(right));
  container.innerHTML = keys.map(key => `<span class="default-attr-chip">${escapeHtml(key)}</span>`).join('');
}

function populateCoordinateSelectors(headers) {
  const latSelect = document.getElementById('latSelect');
  const lonSelect = document.getElementById('lonSelect');
  if (!latSelect || !lonSelect) return;

  const options = ['<option value="">— select a column —</option>']
    .concat(headers.map(header => `<option value="${escapeAttribute(header)}">${escapeHtml(header)}</option>`));

  latSelect.innerHTML = options.join('');
  lonSelect.innerHTML = options.join('');

  const guessedLat = guessCoordinateField(headers, ['latitude', 'lat', 'ycoord', 'y_coordinate'], ['y']);
  const guessedLon = guessCoordinateField(headers, ['longitude', 'lon', 'lng', 'xcoord', 'x_coordinate'], ['x']);

  if (guessedLat) latSelect.value = guessedLat;
  if (guessedLon) lonSelect.value = guessedLon;

  const wktSelect = document.getElementById('wktSelect');
  if (wktSelect) {
    wktSelect.innerHTML = ['<option value="">\u2014 select a column \u2014</option>']
      .concat(headers.map(h => `<option value="${escapeAttribute(h)}">${escapeHtml(h)}</option>`))
      .join('');
    const guessedWkt = guessWktColumn(headers, state.workingRows);
    if (guessedWkt) wktSelect.value = guessedWkt;
  }
}

function renderAttributeTable(filterText = '') {
  const tbody = document.getElementById('attributeTableBody');
  if (!tbody) return;

  const term = String(filterText || '').trim().toLowerCase();
  const filtered = state.attributes.filter(attribute => {
    if (!term) return true;
    return [attribute.key, attribute.alias, attribute.description]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(term));
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-secondary py-4">No attributes match that filter.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(attribute => {
    const isDefault = DEFAULT_ATTRIBUTES.includes(attribute.key);
    const checked = state.selectedAttributes.has(attribute.key) || isDefault;
    const checkboxAttrs = isDefault ? 'checked disabled' : (checked ? 'checked' : '');
    const desc = attribute.description || attribute.alias || '—';

    return `
      <tr>
        <td>
          <input class="form-check-input attr-checkbox" type="checkbox" value="${escapeAttribute(attribute.key)}" ${checkboxAttrs}>
        </td>
        <td>
          <div class="attribute-key">${escapeHtml(attribute.key)} ${isDefault ? '<span class="badge text-bg-primary default-pill">default</span>' : ''}</div>
        </td>
        <td>${escapeHtml(desc)}</td>
      </tr>
    `;
  }).join('');
}

function updateSelectionSummary() {
  const selectedCount = state.selectedAttributes.size;
  const el = document.getElementById('selectedCount');
  if (el) el.textContent = `${selectedCount} selected`;
}

function canAdvanceFromStep1() {
  if (!state.workingRows.length) return false;
  if (state.coordinateMode === 'wkt' || state.coordinateMode === 'other') {
    return Boolean(state.wktColumn && state.wktDerivedCols.lat && state.wktDerivedCols.lon);
  }
  const latField = document.getElementById('latSelect')?.value;
  const lonField = document.getElementById('lonSelect')?.value;
  return Boolean(latField && lonField && latField !== lonField);
}

function canAccessStep3() {
  return canAdvanceFromStep1() && selectedAttributeList().length > 0;
}

function canAccessStep4() {
  return Boolean(state.workingRows.length && state.lastProcessedAt);
}

function updateUIState() {
  const step1Ready = canAdvanceFromStep1();
  const step3Ready = canAccessStep3();
  const step4Ready = canAccessStep4();

  const toStep2Btn = document.getElementById('toStep2Btn');
  const toStep3Btn = document.getElementById('toStep3Btn');
  const toStep4Btn = document.getElementById('toStep4Btn');
  const processBtn = document.getElementById('processBtn');

  if (toStep2Btn) toStep2Btn.disabled = !step1Ready;
  if (toStep3Btn) toStep3Btn.disabled = !step3Ready;
  if (toStep4Btn) toStep4Btn.disabled = !step4Ready;
  if (processBtn) processBtn.disabled = !step3Ready || state.isProcessing;

  const backBtn = document.getElementById('backStepBtn');
  const nextBtn = document.getElementById('nextStepBtn');
  if (backBtn) backBtn.disabled = state.currentStep <= 1;
  if (nextBtn) nextBtn.disabled = state.currentStep >= 4;

  document.querySelectorAll('.export-dl-btn').forEach(btn => {
    const needsDuckdb = ['parquet', 'geoparquet'].includes(btn.dataset.format);
    btn.disabled = !step4Ready || state.isProcessing || (needsDuckdb && !state.dbReady);
  });
}

function goToStep(step, options = {}) {
  if (!options.force) {
    if (step === 2 && !canAdvanceFromStep1()) {
      updateStatus('Load a CSV and confirm the latitude and longitude columns before moving on.', 'warning');
      return;
    }
    if (step === 3 && !canAccessStep3()) {
      updateStatus('Step 3 needs a loaded CSV, mapped coordinates, and the selected attributes.', 'warning');
      return;
    }
    if (step === 4 && !canAccessStep4()) {
      updateStatus('Process the selected attributes in Step 3 before moving to Extract.', 'warning');
      return;
    }
  }

  state.currentStep = step;
  const track = document.getElementById('workflowTrack');
  if (track) {
    track.style.transform = `translateX(-${(step - 1) * 100}%)`;
  }

  document.querySelectorAll('.workflow-tab').forEach(button => {
    button.classList.toggle('is-active', Number(button.dataset.step) === step);
  });

  if (step === 1) {
    renderLoadPreviewTable(state.workingRows, state.workingRows.length ? 'Spreadsheet preview' : 'No file loaded');
  }
  if (step === 3) {
    renderReviewTable();
  }
  if (step === 4) {
    renderExportSummary();
  }

  updateUIState();
}

function buildTabulatorColumns(columnsToShow) {
  return [
    {
      title: '#',
      formatter: 'rownum',
      headerSort: false,
      hozAlign: 'right',
      headerHozAlign: 'right',
      width: 50,
      cssClass: 'row-number-cell'
    },
    ...columnsToShow.map(name => ({
      title: name.toUpperCase(),
      field: name,
      headerSort: false,
      minWidth: 140,
      headerTooltip: name,
      tooltip(cell) {
        const value = cell.getValue();
        return value === null || value === undefined || value === '' ? '' : String(value);
      },
      formatter(cell) {
        const value = cell.getValue();
        return value === null || value === undefined || value === ''
          ? '<span class="text-secondary">—</span>'
          : escapeHtml(String(value));
      }
    }))
  ];
}

// Update load table columns in-place (no destroy/recreate — avoids layout jump)
function updateLoadTableColumns() {
  if (!state.tables.load) return;
  const lat = document.getElementById('latSelect')?.value;
  const lon = document.getElementById('lonSelect')?.value;
  const base = state.originalColumnOrder.length ? state.originalColumnOrder : [];
  const visible = state.selectedColumns.size
    ? base.filter(col => state.selectedColumns.has(col) || col === lat || col === lon)
    : base;
  state.tables.load.setColumns(buildTabulatorColumns(visible));
}

function renderLoadPreviewTable(rows, badgeText = 'No file loaded') {
  // Always include locked lat/lon columns, union with user-selected columns
  const lat = document.getElementById('latSelect')?.value;
  const lon = document.getElementById('lonSelect')?.value;
  const base = state.originalColumnOrder.length ? state.originalColumnOrder : collectColumns(rows);
  const columns = state.selectedColumns.size
    ? base.filter(col => state.selectedColumns.has(col) || col === lat || col === lon)
    : base;
  const badge = rows.length ? `${rows.length.toLocaleString()} row(s)` : badgeText;
  renderDataTable('loadPreviewTable', 'loadPreviewBadge', rows, badge, columns, 'load');
}

function renderReviewTable() {
  const rows = state.workingRows;
  const badgeText = rows.length
    ? `${state.lastProcessedAt ? 'Processed review' : 'Ready for processing'} · ${rows.length.toLocaleString()} row(s)`
    : 'No review yet';
  renderDataTable('previewTable', 'previewBadge', rows, badgeText, getReviewColumns(), 'review');
}

function updateReviewTableData(processed, total) {
  const badge = document.getElementById('previewBadge');
  if (badge) badge.textContent = `Processing… ${processed.toLocaleString()} / ${total.toLocaleString()} row(s)`;
  if (!state.tables.review) {
    renderReviewTable();
    return;
  }
  state.tables.review.setData(state.workingRows);
}

function renderDataTable(containerId, badgeId, rows, badgeText, visibleColumns, tableKey) {
  const container = document.getElementById(containerId);
  const badge = document.getElementById(badgeId);
  if (!container) return;
  if (badge) badge.textContent = badgeText;

  if (state.tables[tableKey]) {
    state.tables[tableKey].destroy();
    state.tables[tableKey] = null;
  }

  if (!rows.length) {
    container.innerHTML = '<div class="text-secondary py-4 px-2">No rows to preview yet.</div>';
    return;
  }

  const orderedColumns = Array.from(new Set((visibleColumns || []).filter(Boolean)));
  const columnsToShow = orderedColumns.length ? orderedColumns : collectColumns(rows);

  const tabulatorColumns = buildTabulatorColumns(columnsToShow);

  state.tables[tableKey] = new Tabulator(container, {
    data: rows,
    columns: tabulatorColumns,
    layout: 'fitDataStretch',
    responsiveLayout: false,
    movableColumns: true,
    resizableColumns: true,
    clipboard: true,
    clipboardCopyStyled: false,
    height: '420px',
    pagination: 'local',
    paginationSize: tableKey === 'load' ? 25 : 50,
    paginationSizeSelector: [25, 50, 100, 200],
    placeholder: 'No rows to preview.'
  });
}

async function processCsv() {
  if (!canAccessStep3()) {
    updateStatus('Load a CSV, map the coordinates, and keep at least the locked defaults selected.', 'danger');
    return;
  }

  const latField = document.getElementById('latSelect').value;
  const lonField = document.getElementById('lonSelect').value;
  const selectedKeys = selectedAttributeList();
  state.isProcessing = true;
  updateUIState();
  goToStep(3, { force: true });

  const total = state.workingRows.length;
  const startedAt = performance.now();

  clearProcessConsole();
  logProcessConsole(`Preparing ${total.toLocaleString()} row(s) for processing.`);
  logProcessConsole(`Async batch / Promise.all — up to 500 requests per wave.`);
  logProcessConsole(`Selected keys: ${selectedKeys.join(', ')}`);
  updateStatus(`Processing ${total.toLocaleString()} row(s)…`, 'info');

  try {
    const summary = await processRowsAsync(latField, lonField, selectedKeys);

    state.workingRows = summary.outputRows;
    state.lastProcessedAt = new Date();
    selectedKeys.forEach(key => state.processedKeys.add(key));

    // Stamp every row with the local processing date (YYYY-MM-DD)
    const _d = state.lastProcessedAt;
    const dateStamp = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`;
    state.workingRows.forEach(row => { row.date_processed = dateStamp; });
    renderReviewTable();
    renderExportSummary();

    const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(2);
    const tone = summary.issueCount ? 'warning' : 'success';
    const suffix = summary.issueCount ? ` ${summary.issueCount.toLocaleString()} row(s) need review in the KYTC_Status column.` : '';

    logProcessConsole(`Completed in ${elapsedSeconds}s. Success: ${summary.successCount}. Issues: ${summary.issueCount}.`);
    updateStatus(`Finished ${total.toLocaleString()} row(s) in ${elapsedSeconds}s. ${summary.successCount.toLocaleString()} succeeded.${suffix}`, tone);
  } finally {
    state.isProcessing = false;
    updateUIState();
  }
}

async function processRowsAsync(latField, lonField, selectedKeys) {
  const outputRows = state.workingRows.map(row => ({ ...row }));
  const total = outputRows.length;
  const batchSize = Math.min(500, total || 1);
  const totalBatches = Math.ceil(total / batchSize);
  let successCount = 0;
  let issueCount = 0;

  logProcessConsole(`Async batch size: ${batchSize} row(s) per wave.`);

  for (let start = 0; start < total; start += batchSize) {
    const batchNumber = Math.floor(start / batchSize) + 1;
    const batch = outputRows.slice(start, start + batchSize);
    const results = await Promise.all(
      batch.map((row, index) => enrichRow(row, start + index, latField, lonField, selectedKeys))
    );

    results.forEach((result, index) => {
      outputRows[start + index] = result.row;
      if (result.ok) successCount += 1;
      else issueCount += 1;
    });

    state.workingRows = outputRows;
    const processed = Math.min(start + batch.length, total);
    updateReviewTableData(processed, total);
    updateStatus(`Processed ${processed.toLocaleString()} of ${total.toLocaleString()} row(s)…`, 'info');
    logProcessConsole(`Batch ${batchNumber} of ${totalBatches} complete (${processed.toLocaleString()} / ${total.toLocaleString()}).`);
  }

  return { outputRows, successCount, issueCount };
}

async function enrichRow(row, index, latField, lonField, selectedKeys) {
  const lat = parseNumber(row[latField]);
  const lon = parseNumber(row[lonField]);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return {
      ok: false,
      row: {
        ...row,
        Request_Id: row.Request_Id || `row-${index + 1}`,
        KYTC_Status: 'Invalid latitude/longitude',
        KYTC_Error: 'Row skipped before request.'
      }
    };
  }

  const missingKeys = selectedKeys.filter(key => isEmptyValue(row[key]));
  const requestKeys = missingKeys.length ? missingKeys : (row.KYTC_Status === 'OK' ? [] : selectedKeys);

  if (!requestKeys.length) {
    return {
      ok: true,
      row: {
        ...row,
        Request_Id: row.Request_Id || `row-${index + 1}`,
        KYTC_Status: 'OK',
        KYTC_Error: ''
      }
    };
  }

  try {
    const payload = await fetchRouteInfo(lon, lat, requestKeys, index + 1);
    const routeInfo = extractRouteInfo(payload);
    if (!routeInfo) {
      return {
        ok: false,
        row: {
          ...row,
          Request_Id: row.Request_Id || `row-${index + 1}`,
          KYTC_Status: 'No route info returned',
          KYTC_Error: 'The API returned no Route_Info payload.'
        }
      };
    }

    const merged = { ...row };
    requestKeys.forEach(key => {
      merged[key] = routeInfo[key] ?? merged[key] ?? '';
    });
    merged.Request_Id = routeInfo.Request_Id || row.Request_Id || `row-${index + 1}`;
    merged.KYTC_Status = 'OK';
    merged.KYTC_Error = '';

    return { ok: true, row: merged };
  } catch (error) {
    return {
      ok: false,
      row: {
        ...row,
        Request_Id: row.Request_Id || `row-${index + 1}`,
        KYTC_Status: 'Request failed',
        KYTC_Error: error.message || 'The KYTC API request failed.'
      }
    };
  }
}

async function fetchRouteInfo(lon, lat, selectedKeys, requestNumber) {
  const url = buildRequestUrl(lon, lat, selectedKeys, requestNumber);
  return fetchJsonWithRetry(url, 2, 10000);
}

function buildRequestUrl(lon, lat, selectedKeys, requestNumber) {
  const url = new URL(KYTC_ENDPOINT);
  url.search = new URLSearchParams({
    xcoord: String(lon),
    ycoord: String(lat),
    snap_distance: '200',
    return_keys: selectedKeys.join(', '),
    return_format: 'json',
    input_epsg: '4326',
    output_epsg: '4326',
    request_id: `row-${requestNumber}`,
  }).toString();
  return url.toString();
}

async function fetchJsonWithRetry(url, retries = 2, timeoutMs = 10000) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok) {
        const text = await response.text();
        if ((response.status === 500 || response.status === 503) && attempt < retries) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        throw new Error(`API ${response.status}: ${text.slice(0, 140)}`);
      }

      return response.json();
    } catch (error) {
      clearTimeout(timer);
      lastError = error?.name === 'AbortError'
        ? new Error(`Timed out after ${timeoutMs / 1000} seconds.`)
        : error;

      if (attempt < retries) {
        await sleep(300 * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError || new Error('The KYTC API request failed.');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractRouteInfo(payload) {
  if (!payload) return null;
  if (payload.Route_Info && typeof payload.Route_Info === 'object') {
    return Array.isArray(payload.Route_Info) ? payload.Route_Info[0] || null : payload.Route_Info;
  }
  if (Array.isArray(payload) && payload.length) {
    const first = payload[0];
    if (first?.Route_Info) return first.Route_Info;
    return first;
  }
  return typeof payload === 'object' ? payload : null;
}

async function downloadSelectedFormat() {
  await downloadFormat(state.selectedExportFormat);
}

async function downloadFormat(format) {
  if (!canAccessStep4()) {
    updateStatus('Process the data in Step 3 before downloading.', 'warning');
    return;
  }

  const rows = buildExportRows();
  if (!rows.length) {
    updateStatus('There are no processed rows ready to export.', 'warning');
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);

  switch (format) {
    case 'csv':
      downloadCsv(rows, `kytc-roadway-processed-${stamp}.csv`);
      break;
    case 'json':
      downloadBlob(JSON.stringify(rows, null, 2), `kytc-roadway-processed-${stamp}.json`, 'application/json;charset=utf-8;');
      break;
    case 'geojson': {
      const geojson = buildGeoJson(rows);
      downloadBlob(JSON.stringify(geojson, null, 2), `kytc-roadway-processed-${stamp}.geojson`, 'application/geo+json;charset=utf-8;');
      break;
    }
    case 'kml': {
      const kml = buildKml(rows);
      downloadBlob(kml, `kytc-roadway-processed-${stamp}.kml`, 'application/vnd.google-earth.kml+xml;charset=utf-8;');
      break;
    }
    case 'parquet':
      updateStatus('Building Parquet file via DuckDB-WASM…', 'info');
      await downloadParquet(rows, `kytc-roadway-processed-${stamp}.parquet`);
      break;
    case 'geoparquet':
      updateStatus('Building GeoParquet file via DuckDB-WASM…', 'info');
      await downloadGeoParquet(rows, `kytc-roadway-processed-${stamp}.parquet`);
      break;
    case 'xlsx':
      downloadExcel(rows, `kytc-roadway-processed-${stamp}.xlsx`);
      break;
    default:
      updateStatus('That export format is not ready yet.', 'warning');
      return;
  }

  updateStatus(`Downloaded ${format.toUpperCase()} successfully.`, 'success');
}

async function downloadParquet(rows, filename) {
  if (!state.dbReady) {
    throw new Error('DuckDB-WASM is not available. Try CSV export instead.');
  }

  await state.db.registerFileText('_parquet_in.json', JSON.stringify(rows));
  try {
    await state.conn.query("CREATE OR REPLACE TABLE _parquet_export AS SELECT * FROM read_json_auto('_parquet_in.json')");
    await state.conn.query("COPY _parquet_export TO '_parquet_out.parquet' (FORMAT PARQUET)");
    const buffer = await state.db.copyFileToBuffer('_parquet_out.parquet');
    downloadBlob(buffer, filename, 'application/octet-stream');
    logProcessConsole(`Parquet export: ${rows.length.toLocaleString()} rows, ${(buffer.byteLength / 1024).toFixed(1)} KB.`);
  } finally {
    await state.db.dropFile('_parquet_in.json').catch(() => {});
    await state.db.dropFile('_parquet_out.parquet').catch(() => {});
    await state.conn.query('DROP TABLE IF EXISTS _parquet_export').catch(() => {});
  }
}

async function downloadGeoParquet(rows, filename) {
  if (!state.dbReady) {
    throw new Error('DuckDB-WASM is not available. Try GeoJSON export instead.');
  }

  const latField = document.getElementById('latSelect')?.value;
  const lonField = document.getElementById('lonSelect')?.value;

  // Add WKT geometry column (readable by GDAL, GeoPandas, QGIS as geometry)
  const rowsWithGeom = rows.map(row => {
    const lat = parseNumber(row[latField]);
    const lon = parseNumber(row[lonField]);
    return {
      ...row,
      geometry: (Number.isFinite(lat) && Number.isFinite(lon)) ? `POINT (${lon} ${lat})` : null,
    };
  });

  await state.db.registerFileText('_geoparquet_in.json', JSON.stringify(rowsWithGeom));
  try {
    await state.conn.query("CREATE OR REPLACE TABLE _geoparquet_export AS SELECT * FROM read_json_auto('_geoparquet_in.json')");
    await state.conn.query("COPY _geoparquet_export TO '_geoparquet_out.parquet' (FORMAT PARQUET)");
    const buffer = await state.db.copyFileToBuffer('_geoparquet_out.parquet');
    downloadBlob(buffer, filename, 'application/octet-stream');
    logProcessConsole(`GeoParquet export: ${rows.length.toLocaleString()} rows, ${(buffer.byteLength / 1024).toFixed(1)} KB. Geometry column: WKT POINT.`);
  } finally {
    await state.db.dropFile('_geoparquet_in.json').catch(() => {});
    await state.db.dropFile('_geoparquet_out.parquet').catch(() => {});
    await state.conn.query('DROP TABLE IF EXISTS _geoparquet_export').catch(() => {});
  }
}

function buildExportRows() {
  const cols = getReviewColumns();
  return state.workingRows.map(row => {
    const exportRow = {};
    cols.forEach(col => {
      exportRow[col] = row[col] ?? '';
    });
    return exportRow;
  });
}

function buildGeoJson(rows) {
  const latField = document.getElementById('latSelect')?.value;
  const lonField = document.getElementById('lonSelect')?.value;

  const features = rows.map((row, index) => {
    const lat = parseNumber(row[latField]);
    const lon = parseNumber(row[lonField]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [lon, lat],
      },
      properties: {
        ...row,
        export_index: index + 1,
      }
    };
  }).filter(Boolean);

  return {
    type: 'FeatureCollection',
    features,
  };
}

function buildKml(rows) {
  const latField = document.getElementById('latSelect')?.value;
  const lonField = document.getElementById('lonSelect')?.value;

  const placemarks = rows.map((row, index) => {
    const lat = parseNumber(row[latField]);
    const lon = parseNumber(row[lonField]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';

    const name = escapeXml(row.Road_Name || row.Route_Label || row.County_Name || `Row ${index + 1}`);
    const details = Object.entries(row)
      .map(([key, value]) => `<tr><td><b>${escapeXml(key)}</b></td><td>${escapeXml(value ?? '')}</td></tr>`)
      .join('');

    return `
      <Placemark>
        <name>${name}</name>
        <description><![CDATA[<table>${details}</table>]]></description>
        <Point><coordinates>${lon},${lat},0</coordinates></Point>
      </Placemark>
    `;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>KYTC Roadway Processor Export</name>
    ${placemarks}
  </Document>
</kml>`;
}

function downloadCsv(rows, filename) {
  const columns = Object.keys(rows[0] || {});
  const lines = [columns.map(escapeCsv).join(',')];

  rows.forEach(row => {
    const values = columns.map(column => escapeCsv(row[column] ?? ''));
    lines.push(values.join(','));
  });

  downloadBlob(lines.join('\n'), filename, 'text/csv;charset=utf-8;');
}

function downloadExcel(rows, filename) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'KYTC Roadway');
  XLSX.writeFile(wb, filename);
}

function downloadBlob(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function renderExportSummary() {
  if (!canAccessStep4()) {
    const badge = document.getElementById('exportPreviewBadge');
    const container = document.getElementById('exportPreviewTable');
    if (badge) badge.textContent = '0 rows ready';
    if (container) container.innerHTML = '<div class="text-secondary py-4 px-2">Process data in Step 3 to unlock downloads.</div>';
    if (state.tables.export) { state.tables.export.destroy(); state.tables.export = null; }
    return;
  }

  renderExportTable();
  updateExportOptionStyles();
}

function renderExportTable() {
  const container = document.getElementById('exportPreviewTable');
  const badge = document.getElementById('exportPreviewBadge');
  if (!container) return;

  if (state.tables.export) {
    state.tables.export.destroy();
    state.tables.export = null;
  }

  if (!canAccessStep4() || !state.workingRows.length) {
    container.innerHTML = '<div class="text-secondary py-4 px-2">No rows to preview.</div>';
    return;
  }

  const cols = getReviewColumns();
  const totalRows = state.workingRows.length;

  if (badge) badge.textContent = `${totalRows.toLocaleString()} rows · ${cols.length} column${cols.length !== 1 ? 's' : ''}`;

  if (!cols.length) {
    container.innerHTML = '<div class="text-secondary py-4 px-2">No columns found — check your selections in Steps 1 and 2.</div>';
    return;
  }

  const previewRows = state.workingRows.slice(0, 10).map(row => {
    const r = {};
    cols.forEach(col => { r[col] = row[col] ?? ''; });
    return r;
  });

  state.tables.export = new Tabulator(container, {
    data: previewRows,
    columns: buildTabulatorColumns(cols),
    layout: 'fitDataStretch',
    responsiveLayout: false,
    movableColumns: false,
    resizableColumns: true,
    clipboard: false,
    height: '420px',
    pagination: false,
    placeholder: 'No rows to preview.'
  });
}

function updateExportOptionStyles() {
  document.querySelectorAll('.export-option').forEach(option => {
    const input = option.querySelector('input[name="exportFormat"]');
    option.classList.toggle('is-selected', Boolean(input?.checked));
  });
}

function selectedAttributeList() {
  const orderedKeys = state.attributes.length
    ? state.attributes.map(attribute => attribute.key)
    : Array.from(state.selectedAttributes);

  return orderedKeys.filter(key => state.selectedAttributes.has(key));
}

function getReviewColumns() {
  const ordered = [];
  const seen = new Set();
  const add = (value) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    ordered.push(value);
  };

  state.originalColumnOrder.forEach(add);
  selectedAttributeList().forEach(add);

  ['Request_Id', 'KYTC_Status', 'KYTC_Error', 'date_processed'].forEach(column => {
    if (state.workingRows.some(row => !isEmptyValue(row[column]))) {
      add(column);
    }
  });

  return ordered;
}

function normalizeHeaderMap(headers) {
  const used = new Set();

  return headers.map((header, index) => {
    const original = String(header || `Column_${index + 1}`).replace(/^\uFEFF/, '').trim() || `Column_${index + 1}`;
    let normalized = original
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (!normalized) normalized = `Column_${index + 1}`;
    if (/^\d/.test(normalized)) normalized = `col_${normalized}`;

    let unique = normalized;
    let suffix = 2;
    while (used.has(unique)) {
      unique = `${normalized}_${suffix}`;
      suffix += 1;
    }
    used.add(unique);

    return { original, normalized: unique };
  });
}

function normalizeRow(row, headerMap) {
  const normalizedRow = {};
  headerMap.forEach(item => {
    normalizedRow[item.normalized] = row[item.original] ?? '';
  });
  return normalizedRow;
}

function guessCoordinateField(headers, candidates, exactOnlyCandidates = []) {
  const lowered = headers.map(header => ({ raw: header, value: String(header).toLowerCase() }));

  // Exact match: all candidates including exact-only ones
  for (const candidate of [...candidates, ...exactOnlyCandidates]) {
    const exact = lowered.find(header => header.value === candidate);
    if (exact) return exact.raw;
  }

  // Partial match: regular candidates only (exact-only candidates are too short/ambiguous)
  for (const candidate of candidates) {
    const partial = lowered.find(header => header.value.includes(candidate));
    if (partial) return partial.raw;
  }

  return '';
}

function collectColumns(rows) {
  const ordered = [];
  const seen = new Set();

  rows.forEach(row => {
    Object.keys(row).forEach(key => {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    });
  });

  return ordered;
}

function updateStatus(message, tone = 'info') {
  const el = document.getElementById('statusMessage');
  if (el) {
    el.className = `status-banner ${tone}`;
    el.textContent = message;
  }

  const indicatorTone = {
    info: 'loading',
    success: 'ready',
    warning: 'warning',
    danger: 'error',
  }[tone] || 'ready';

  const indicatorText = {
    info: 'Working',
    success: 'Ready',
    warning: 'Review',
    danger: 'Error',
  }[tone] || 'Ready';

  setProcessorIndicator(indicatorTone, indicatorText);
}

function setProcessorIndicator(tone, text) {
  const dot = document.getElementById('processorStatusDot');
  const label = document.getElementById('processorStatusText');
  if (dot) dot.className = `sql-status-dot ${tone}`;
  if (label) label.textContent = text;
}

function setDuckDbIndicator(tone, text) {
  const dot = document.getElementById('duckdbStatusDot');
  const label = document.getElementById('duckdbStatusText');
  if (dot) dot.className = `sql-status-dot ${tone}`;
  if (label) label.textContent = text;
}

function clearProcessConsole() {
  state.logLines = [];
  const el = document.getElementById('processConsole');
  if (el) {
    el.textContent = 'Request log will appear here after you load a CSV.';
  }
}

function logProcessConsole(message) {
  const el = document.getElementById('processConsole');
  if (!el) return;

  const stamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  state.logLines.push(`[${stamp}] ${message}`);
  state.logLines = state.logLines.slice(-80);
  el.textContent = state.logLines.join('\n');
  el.scrollTop = el.scrollHeight;
}

function parseWktPoint(value) {
  const match = String(value ?? '').match(
    /POINT\s*(?:Z\s*|M\s*|ZM\s*)?\(\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/i
  );
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lon, lat };
}

function deriveUniqueName(baseName, existingSet) {
  if (!existingSet.has(baseName)) return baseName;
  let suffix = 2;
  while (existingSet.has(`${baseName}_${suffix}`)) suffix += 1;
  return `${baseName}_${suffix}`;
}

function guessWktColumn(headers, rows) {
  const exactNames = ['geometry', 'geom', 'shape', 'wkt', 'the_geom', 'geo', 'pt'];
  const lower = headers.map(h => ({ raw: h, lc: String(h).toLowerCase() }));
  for (const name of exactNames) {
    const found = lower.find(h => h.lc === name);
    if (found) return found.raw;
  }
  // Value scan: check first 5 rows for any column containing a parseable WKT POINT
  const sample = (rows || []).slice(0, 5);
  for (const col of headers) {
    if (sample.some(row => parseWktPoint(row[col]) !== null)) return col;
  }
  return '';
}

function applyWktColumn(colName, swapCoords = false) {
  removeWktDerivedCols();

  if (!colName || !state.workingRows.length) {
    state.wktColumn = null;
    updateUIState();
    return;
  }

  const existingCols = new Set(state.originalColumnOrder);
  const latColName = deriveUniqueName('wkt_latitude', existingCols);
  const lonColName = deriveUniqueName('wkt_longitude', existingCols);

  let parseFailCount = 0;
  state.workingRows.forEach(row => {
    const parsed = parseWktPoint(row[colName]);
    if (parsed) {
      row[latColName] = swapCoords ? String(parsed.lon) : String(parsed.lat);
      row[lonColName] = swapCoords ? String(parsed.lat) : String(parsed.lon);
    } else {
      row[latColName] = '';
      row[lonColName] = '';
      parseFailCount += 1;
    }
  });

  state.originalColumnOrder.push(lonColName, latColName);
  state.selectedColumns.add(latColName);
  state.selectedColumns.add(lonColName);
  state.headerMap.push(
    { original: lonColName, normalized: lonColName },
    { original: latColName, normalized: latColName }
  );

  state.wktColumn = colName;
  state.wktDerivedCols = { lat: latColName, lon: lonColName };

  // Point the (hidden) lat/lon selects at the derived columns
  const latSel = document.getElementById('latSelect');
  const lonSel = document.getElementById('lonSelect');
  for (const [sel, val] of [[latSel, latColName], [lonSel, lonColName]]) {
    if (!sel) continue;
    if (!Array.from(sel.options).some(o => o.value === val)) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      sel.appendChild(opt);
    }
    sel.value = val;
  }

  const successCount = state.workingRows.length - parseFailCount;
  const statusEl = document.getElementById('wktParseStatus');
  if (statusEl) {
    if (parseFailCount) {
      statusEl.className = 'small text-warning mt-1';
      statusEl.textContent = `${successCount.toLocaleString()} of ${state.workingRows.length.toLocaleString()} rows parsed. ${parseFailCount.toLocaleString()} could not be parsed and will be flagged during processing.`;
    } else {
      statusEl.className = 'small text-success mt-1';
      statusEl.textContent = `All ${successCount.toLocaleString()} row(s) parsed successfully.`;
    }
    statusEl.classList.remove('d-none');
  }

  if (parseFailCount) {
    logProcessConsole(`WKT "${colName}": ${successCount.toLocaleString()} parsed, ${parseFailCount.toLocaleString()} failed.`);
  } else {
    logProcessConsole(`WKT "${colName}": all ${successCount.toLocaleString()} row(s) parsed \u2192 ${latColName}, ${lonColName}.`);
  }

  renderColumnSelector(state.headerMap);
  renderLoadPreviewTable(state.workingRows, 'Spreadsheet preview');
  renderReviewTable();
  updateUIState();
}

function removeWktDerivedCols() {
  const { lat, lon } = state.wktDerivedCols;
  if (!lat && !lon) return;

  const toDrop = new Set([lat, lon].filter(Boolean));
  state.workingRows.forEach(row => {
    toDrop.forEach(col => { delete row[col]; });
  });
  state.originalColumnOrder = state.originalColumnOrder.filter(c => !toDrop.has(c));
  toDrop.forEach(c => state.selectedColumns.delete(c));
  state.headerMap = state.headerMap.filter(item => !toDrop.has(item.normalized));

  const latSel = document.getElementById('latSelect');
  const lonSel = document.getElementById('lonSelect');
  [latSel, lonSel].forEach(sel => {
    if (!sel) return;
    Array.from(sel.options).filter(o => toDrop.has(o.value)).forEach(o => o.remove());
    if (toDrop.has(sel.value)) sel.value = '';
  });

  const statusEl = document.getElementById('wktParseStatus');
  if (statusEl) statusEl.classList.add('d-none');

  state.wktColumn = null;
  state.wktDerivedCols = { lat: null, lon: null };
}

function switchCoordinateMode(mode) {
  state.coordinateMode = mode;
  const separateFields = document.getElementById('coordSeparateFields');
  const wktFields = document.getElementById('coordWktFields');
  const hintStandard = document.getElementById('wktHintStandard');
  const hintOther = document.getElementById('wktHintOther');

  if (mode === 'wkt' || mode === 'other') {
    separateFields?.classList.add('d-none');
    wktFields?.classList.remove('d-none');
    hintStandard?.classList.toggle('d-none', mode === 'other');
    hintOther?.classList.toggle('d-none', mode === 'wkt');
    const wktSel = document.getElementById('wktSelect');
    if (wktSel?.value && state.workingRows.length) {
      applyWktColumn(wktSel.value, mode === 'other');
    } else {
      updateUIState();
    }
  } else {
    wktFields?.classList.add('d-none');
    separateFields?.classList.remove('d-none');
    removeWktDerivedCols();
    refreshColumnLocks();
    renderLoadPreviewTable(state.workingRows, state.workingRows.length ? 'Spreadsheet preview' : 'No file loaded');
    renderReviewTable();
    updateUIState();
  }
}

function parseNumber(value) {
  if (value === null || value === undefined) return Number.NaN;
  const cleaned = String(value).trim();
  if (!cleaned) return Number.NaN;
  return Number(cleaned);
}

function isEmptyValue(value) {
  return value === undefined || value === null || value === '';
}

function escapeCsv(value) {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function parseCSV(text) {
  const safeText = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let headers = null;
  let current = '';
  let fields = [];
  let inQuotes = false;

  const flushField = () => {
    fields.push(current);
    current = '';
  };

  const flushRow = () => {
    flushField();
    if (!headers) {
      headers = fields.map(field => field.trim());
    } else if (fields.some(field => field !== '')) {
      const row = {};
      headers.forEach((header, index) => {
        row[header] = fields[index] ?? '';
      });
      rows.push(row);
    }
    fields = [];
  };

  for (let index = 0; index < safeText.length; index += 1) {
    const char = safeText[index];
    const next = safeText[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      flushField();
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      flushRow();
      continue;
    }

    current += char;
  }

  if (current.length || fields.length) {
    flushRow();
  }

  return rows;
}
