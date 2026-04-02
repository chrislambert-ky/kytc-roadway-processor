/**
 * KYTC Roadway Processor — Main Application Controller
 */
import { DuckDBWrapper, detectFormat } from './duckdb.js';
import { AVAILABLE_ATTRIBUTES, ATTRIBUTE_CATEGORIES, processRows } from './kytc.js';
import {
  downloadData,
  buildGeoJSON,
  buildKML,
  buildKMZ,
  suggestCoordColumns,
} from './export.js';

// ── State ──────────────────────────────────────────────────────────────────
const db = new DuckDBWrapper();
let state = {
  step: 1,
  loaded: false,
  processed: false,
  columns: [],        // {name, type}[]  for user_data (without _row_id)
  rowCount: 0,
  latCol: null,
  lonCol: null,
  selectedAttributes: new Set(),
  currentPage: 1,
  pageSize: 50,
  finalPage: 1,
  processingController: null, // AbortController for cancel
};

// ── DOM helper ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── Entry Point ────────────────────────────────────────────────────────────
// ES modules execute after the HTML is parsed, but DOMContentLoaded may have
// already fired. Guard both cases.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

function boot() {
  setupEventListeners();
  initDuckDB();
}

async function initDuckDB() {
  try {
    updateDbStatus('loading');
    await db.init();
    updateDbStatus('ready');
    showToast('DuckDB-WASM ready', 'success');
  } catch (err) {
    updateDbStatus('error');
    showToast(`Failed to initialize DuckDB: ${err.message}`, 'error');
    console.error('DuckDB init error:', err);
  }
}

// ── Step Navigation ────────────────────────────────────────────────────────
function navigateTo(n) {
  for (let i = 1; i <= 5; i++) {
    const section = $(`step-${i}`);
    if (section) section.hidden = i !== n;
  }
  state.step = n;
  updateStepper(n);
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Side effects per step
  if (n === 3) buildAttributePanel();
  if (n === 5) initExportStep();
}

function updateStepper(active) {
  for (let i = 1; i <= 5; i++) {
    const el = $(`stepper-${i}`);
    if (!el) continue;
    el.classList.remove('stepper-active', 'stepper-done', 'stepper-pending');
    if (i < active) el.classList.add('stepper-done');
    else if (i === active) el.classList.add('stepper-active');
    else el.classList.add('stepper-pending');
  }
}

// ── Event Listeners ────────────────────────────────────────────────────────
function setupEventListeners() {
  // Step 1: Import
  $('file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadFile(file);
  });
  $('url-load-btn').addEventListener('click', handleUrlLoad);
  $('url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleUrlLoad();
  });

  // Drag & drop
  const dropZone = $('drop-zone');
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });
  dropZone.addEventListener('click', () => $('file-input').click());

  // Step 2: Configure
  $('prev-page-btn').addEventListener('click', () => changePage(-1));
  $('next-page-btn').addEventListener('click', () => changePage(1));
  $('back-to-import-btn').addEventListener('click', () => navigateTo(1));
  $('to-attributes-btn').addEventListener('click', () => {
    if (!state.latCol || !state.lonCol) {
      showToast('Please select latitude and longitude columns.', 'warn');
      return;
    }
    navigateTo(3);
  });

  // Step 3: Attributes
  $('select-all-btn').addEventListener('click', () => toggleAllAttributes(true));
  $('clear-all-btn').addEventListener('click', () => toggleAllAttributes(false));
  $('back-to-configure-btn').addEventListener('click', () => navigateTo(2));
  $('to-process-btn').addEventListener('click', () => {
    if (state.selectedAttributes.size === 0) {
      showToast('Please select at least one roadway attribute.', 'warn');
      return;
    }
    navigateTo(4);
  });

  // Step 4: Process
  $('process-btn').addEventListener('click', handleProcess);
  $('cancel-btn').addEventListener('click', handleCancel);
  $('back-to-attributes-btn').addEventListener('click', () => navigateTo(3));
  $('to-export-btn').addEventListener('click', () => navigateTo(5));

  // Step 5: Export
  ['csv', 'json', 'parquet', 'geojson', 'kml', 'kmz'].forEach((fmt) => {
    $(`export-${fmt}-btn`).addEventListener('click', () => handleExport(fmt));
  });
  $('final-prev-page-btn').addEventListener('click', () => changeFinalPage(-1));
  $('final-next-page-btn').addEventListener('click', () => changeFinalPage(1));
  $('back-to-process-btn').addEventListener('click', () => navigateTo(4));
  $('start-over-btn').addEventListener('click', handleStartOver);
}

// ── Step 1: Import ─────────────────────────────────────────────────────────
async function handleUrlLoad() {
  const url = $('url-input').value.trim();
  if (!url) { showToast('Please enter a URL.', 'warn'); return; }
  const format = $('format-select').value;
  await loadFromUrl(url, format);
}

async function loadFile(file) {
  if (!db._initialized) {
    showToast('DuckDB is still loading. Please wait.', 'warn');
    return;
  }
  const format = $('format-select').value;
  setImportLoading(true, `Loading ${file.name}…`);
  try {
    const info = await db.loadFile(file, format === 'auto' ? detectFormat(file.name) : format);
    await onDataLoaded(info);
    showToast(`Loaded ${info.rowCount.toLocaleString()} rows from ${file.name}`, 'success');
  } catch (err) {
    showToast(`Error loading file: ${err.message}`, 'error');
    console.error(err);
  } finally {
    setImportLoading(false);
  }
}

async function loadFromUrl(url, format) {
  if (!db._initialized) {
    showToast('DuckDB is still loading. Please wait.', 'warn');
    return;
  }
  setImportLoading(true, 'Fetching data from URL…');
  try {
    const info = await db.loadUrl(url, format);
    await onDataLoaded(info);
    showToast(`Loaded ${info.rowCount.toLocaleString()} rows from URL`, 'success');
  } catch (err) {
    showToast(`Error loading URL: ${err.message}`, 'error');
    console.error(err);
  } finally {
    setImportLoading(false);
  }
}

async function onDataLoaded(info) {
  state.columns = info.columns.filter((c) => c.name !== '_row_id');
  state.rowCount = info.rowCount;
  state.loaded = true;
  state.processed = false;
  state.currentPage = 1;

  // Auto-detect lat/lon columns (includes _row_id, so filter after)
  const { latCol, lonCol } = suggestCoordColumns(info.columns);
  state.latCol = latCol;
  state.lonCol = lonCol;

  // Update info banner
  const infoEl = $('data-info');
  infoEl.textContent = `✓ ${info.rowCount.toLocaleString()} rows × ${state.columns.length} columns loaded`;
  infoEl.classList.remove('hidden');
  $('import-status').textContent = '';

  // Populate coordinate selectors
  populateCoordSelects(info.columns);

  // Render preview table
  await renderDataTable();

  navigateTo(2);
}

function setImportLoading(loading, msg = '') {
  $('url-load-btn').disabled = loading;
  $('file-input').disabled = loading;
  $('import-status').textContent = msg;
  if (loading) {
    $('import-spinner').classList.remove('hidden');
  } else {
    $('import-spinner').classList.add('hidden');
  }
}

// ── Step 2: Preview & Configure ────────────────────────────────────────────
function populateCoordSelects(columns) {
  const latSel = $('lat-col-select');
  const lonSel = $('lon-col-select');
  latSel.innerHTML = '<option value="">-- select column --</option>';
  lonSel.innerHTML = '<option value="">-- select column --</option>';

  const dataColumns = columns.filter((c) => c.name !== '_row_id');
  for (const col of dataColumns) {
    latSel.innerHTML += `<option value="${escapeHtml(col.name)}">${escapeHtml(col.name)} (${escapeHtml(col.type)})</option>`;
    lonSel.innerHTML += `<option value="${escapeHtml(col.name)}">${escapeHtml(col.name)} (${escapeHtml(col.type)})</option>`;
  }

  if (state.latCol) latSel.value = state.latCol;
  if (state.lonCol) lonSel.value = state.lonCol;

  latSel.onchange = () => { state.latCol = latSel.value || null; };
  lonSel.onchange = () => { state.lonCol = lonSel.value || null; };
}

async function renderDataTable() {
  const offset = (state.currentPage - 1) * state.pageSize;
  const rows = await db.getData(state.pageSize, offset);
  const totalPages = Math.ceil(state.rowCount / state.pageSize);

  $('page-info').textContent = `Page ${state.currentPage} of ${totalPages}`;
  $('prev-page-btn').disabled = state.currentPage <= 1;
  $('next-page-btn').disabled = state.currentPage >= totalPages;

  renderTable($('data-table'), state.columns, rows);
}

function changePage(delta) {
  const totalPages = Math.ceil(state.rowCount / state.pageSize);
  state.currentPage = Math.max(1, Math.min(totalPages, state.currentPage + delta));
  renderDataTable();
}

// ── Step 3: Attributes ─────────────────────────────────────────────────────
function buildAttributePanel() {
  const container = $('attributes-container');
  container.innerHTML = '';

  for (const category of ATTRIBUTE_CATEGORIES) {
    const attrs = AVAILABLE_ATTRIBUTES.filter((a) => a.category === category);
    if (attrs.length === 0) continue;

    const section = document.createElement('div');
    section.className = 'mb-4';
    section.innerHTML = `<h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">${escapeHtml(category)}</h4>`;

    const grid = document.createElement('div');
    grid.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2';

    for (const attr of attrs) {
      const checked = state.selectedAttributes.has(attr.key);
      const item = document.createElement('label');
      item.className = 'flex items-start gap-2 p-2 rounded-lg border border-gray-200 cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition-colors';
      item.innerHTML = `
        <input type="checkbox" class="mt-0.5 accent-blue-600"
               data-key="${escapeHtml(attr.key)}" ${checked ? 'checked' : ''}>
        <div>
          <div class="text-sm font-medium text-gray-800">${escapeHtml(attr.label)}</div>
          <div class="text-xs text-gray-500">${escapeHtml(attr.description)}</div>
        </div>`;
      item.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) {
          state.selectedAttributes.add(attr.key);
        } else {
          state.selectedAttributes.delete(attr.key);
        }
        updateAttributeCount();
      });
      grid.appendChild(item);
    }

    section.appendChild(grid);
    container.appendChild(section);
  }

  updateAttributeCount();
}

function toggleAllAttributes(checked) {
  const inputs = $('attributes-container').querySelectorAll('input[type="checkbox"]');
  inputs.forEach((inp) => {
    inp.checked = checked;
    const key = inp.dataset.key;
    if (checked) state.selectedAttributes.add(key);
    else state.selectedAttributes.delete(key);
  });
  updateAttributeCount();
}

function updateAttributeCount() {
  const count = state.selectedAttributes.size;
  $('attr-count').textContent = `${count} attribute${count !== 1 ? 's' : ''} selected`;
}

// ── Step 4: Process ────────────────────────────────────────────────────────
async function handleProcess() {
  if (!state.latCol || !state.lonCol) {
    showToast('Please select latitude and longitude columns (go back to Step 2).', 'warn');
    return;
  }
  if (state.selectedAttributes.size === 0) {
    showToast('Please select at least one attribute (go back to Step 3).', 'warn');
    return;
  }

  const selectedKeys = Array.from(state.selectedAttributes);
  const snapDistance = parseInt($('snap-distance').value, 10) || 100;

  // Gather all rows
  const allRows = await db.getAllRows();
  const coordRows = allRows.map((row) => ({
    rowId: row._row_id,
    lat: parseFloat(row[state.latCol]),
    lon: parseFloat(row[state.lonCol]),
  }));

  // UI setup
  $('process-btn').disabled = true;
  $('cancel-btn').disabled = false;
  $('to-export-btn').disabled = true;
  $('progress-bar').style.width = '0%';
  $('progress-text').textContent = '0%';
  $('progress-stats').textContent = `0 / ${coordRows.length.toLocaleString()}`;
  $('log-container').innerHTML = '';
  $('process-summary').classList.add('hidden');

  state.processingController = new AbortController();
  let errorCount = 0;
  let notFoundCount = 0;
  const kytcResults = [];
  const startTime = Date.now();

  await processRows(
    coordRows,
    selectedKeys,
    { snapDistance },
    ({ done, total, rowId, result, error }) => {
      // Progress bar
      const pct = Math.round((done / total) * 100);
      $('progress-bar').style.width = `${pct}%`;
      $('progress-text').textContent = `${pct}%`;

      const elapsed = (Date.now() - startTime) / 1000;
      const rate = done / elapsed;
      const eta = rate > 0 ? Math.round((total - done) / rate) : '—';
      $('progress-stats').textContent =
        `${done.toLocaleString()} / ${total.toLocaleString()} · ETA: ${eta}s`;

      // Log warnings/errors
      if (error && error !== 'Missing coordinates') {
        errorCount++;
        addLogEntry(rowId, 'error', error);
      } else if (!result && !error) {
        notFoundCount++;
        addLogEntry(rowId, 'warn', 'No route found within snap distance');
      }

      // Build result row
      const row = { _row_id: rowId };
      for (const key of selectedKeys) {
        row[key] = result ? (result[key] ?? null) : null;
      }
      kytcResults.push(row);
    },
    state.processingController.signal
  );

  const aborted = state.processingController.signal.aborted;
  state.processingController = null;

  if (!aborted) {
    // Store results in DuckDB and create merged view
    await db.storeKytcResults(kytcResults, selectedKeys);
    state.processed = true;

    const matched = kytcResults.length - notFoundCount - errorCount;
    $('summary-matched').textContent = matched.toLocaleString();
    $('summary-not-found').textContent = notFoundCount.toLocaleString();
    $('summary-errors').textContent = errorCount.toLocaleString();
    $('process-summary').classList.remove('hidden');
    $('to-export-btn').disabled = false;
    $('process-btn').textContent = '↺ Re-process';

    showToast(
      `Done: ${matched} matched, ${notFoundCount} not found, ${errorCount} errors`,
      'success'
    );
  }

  $('process-btn').disabled = false;
  $('cancel-btn').disabled = true;
}

function handleCancel() {
  if (state.processingController) {
    state.processingController.abort();
    showToast('Processing cancelled.', 'warn');
    $('cancel-btn').disabled = true;
    $('process-btn').disabled = false;
  }
}

function addLogEntry(rowId, level, message) {
  const log = $('log-container');
  // Rolling window: remove oldest entry if over 200 to keep DOM lean
  while (log.children.length >= 200) {
    log.removeChild(log.firstChild);
  }
  const cls = level === 'error' ? 'text-red-400' : 'text-yellow-400';
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = `Row ${rowId}: ${message}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ── Step 5: Export ─────────────────────────────────────────────────────────
async function initExportStep() {
  state.finalPage = 1;
  await renderFinalTable();
}

async function renderFinalTable() {
  let columns, rowCount, rows;

  if (state.processed) {
    columns = await db.getFinalColumns();
    rowCount = await db.getFinalRowCount();
    const offset = (state.finalPage - 1) * state.pageSize;
    rows = await db.getFinalData(state.pageSize, offset);
  } else {
    columns = state.columns;
    rowCount = state.rowCount;
    const offset = (state.finalPage - 1) * state.pageSize;
    rows = await db.getData(state.pageSize, offset);
  }

  const totalPages = Math.max(1, Math.ceil(rowCount / state.pageSize));
  $('final-page-info').textContent =
    `Page ${state.finalPage} of ${totalPages} (${rowCount.toLocaleString()} rows)`;
  $('final-prev-page-btn').disabled = state.finalPage <= 1;
  $('final-next-page-btn').disabled = state.finalPage >= totalPages;

  const displayCols = columns.filter((c) => c.name !== '_row_id');
  renderTable($('final-data-table'), displayCols, rows);

  // Enable/disable geo exports
  const hasCoords = !!(state.latCol && state.lonCol);
  ['export-geojson-btn', 'export-kml-btn', 'export-kmz-btn'].forEach((id) => {
    $(id).disabled = !hasCoords;
  });
}

function changeFinalPage(delta) {
  (async () => {
    const count = state.processed ? await db.getFinalRowCount() : state.rowCount;
    const totalPages = Math.max(1, Math.ceil(count / state.pageSize));
    state.finalPage = Math.max(1, Math.min(totalPages, state.finalPage + delta));
    await renderFinalTable();
  })();
}

async function handleExport(format) {
  const btn = $(`export-${format}-btn`);
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Exporting…';

  try {
    switch (format) {
      case 'csv': {
        const bytes = await db.exportToCsv();
        downloadData(bytes, 'kytc_roadway_data.csv', 'text/csv');
        break;
      }
      case 'json': {
        const bytes = await db.exportToJson();
        downloadData(bytes, 'kytc_roadway_data.json', 'application/json');
        break;
      }
      case 'parquet': {
        const bytes = await db.exportToParquet();
        downloadData(bytes, 'kytc_roadway_data.parquet', 'application/octet-stream');
        break;
      }
      case 'geojson':
      case 'kml':
      case 'kmz': {
        const exportRows = state.processed
          ? await db.getFinalData(1_000_000, 0)
          : await db.getAllRows();

        if (format === 'geojson') {
          const { geojson, skipped } = buildGeoJSON(exportRows, state.latCol, state.lonCol);
          downloadData(
            new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' }),
            'kytc_roadway_data.geojson',
            'application/geo+json'
          );
          if (skipped > 0) showToast(`GeoJSON exported. ${skipped} row(s) skipped (invalid coords).`, 'warn');
        } else {
          const { kml, skipped } = buildKML(exportRows, state.latCol, state.lonCol);
          if (format === 'kml') {
            downloadData(
              new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' }),
              'kytc_roadway_data.kml',
              'application/vnd.google-earth.kml+xml'
            );
          } else {
            const kmz = await buildKMZ(kml);
            downloadData(kmz, 'kytc_roadway_data.kmz', 'application/vnd.google-earth.kmz');
          }
          if (skipped > 0) showToast(`${format.toUpperCase()} exported. ${skipped} row(s) skipped (invalid coords).`, 'warn');
        }
        break;
      }
    }
    // Only show generic success toast for formats that don't have their own conditional toast
    if (['csv', 'json', 'parquet'].includes(format)) {
      showToast(`${format.toUpperCase()} export complete.`, 'success');
    }
  } catch (err) {
    showToast(`Export failed: ${err.message}`, 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

async function handleStartOver() {
  state = {
    step: 1,
    loaded: false,
    processed: false,
    columns: [],
    rowCount: 0,
    latCol: null,
    lonCol: null,
    selectedAttributes: new Set(),
    currentPage: 1,
    pageSize: 50,
    finalPage: 1,
    processingController: null,
  };
  $('file-input').value = '';
  $('url-input').value = '';
  $('import-status').textContent = '';
  $('data-info').classList.add('hidden');
  $('data-info').textContent = '';
  navigateTo(1);
}

// ── Generic Table Renderer ─────────────────────────────────────────────────
function renderTable(tableEl, columns, rows) {
  const displayCols = columns.filter((c) => c.name !== '_row_id');
  let html = '<thead><tr class="bg-gray-100 sticky top-0">';
  for (const col of displayCols) {
    html += `<th class="px-3 py-2 text-left text-xs font-semibold text-gray-600 whitespace-nowrap border-b border-gray-200">`;
    html += escapeHtml(col.name);
    if (col.type) {
      html += `<div class="font-normal text-gray-400 text-xs">${escapeHtml(col.type)}</div>`;
    }
    html += '</th>';
  }
  html += '</tr></thead><tbody>';

  if (rows.length === 0) {
    html += `<tr><td colspan="${displayCols.length || 1}" class="text-center py-8 text-gray-400">No data</td></tr>`;
  } else {
    for (const row of rows) {
      html += '<tr class="hover:bg-blue-50 border-b border-gray-100">';
      for (const col of displayCols) {
        const val = row[col.name];
        const display =
          val == null
            ? '<span class="text-gray-300">null</span>'
            : escapeHtml(String(val));
        html += `<td class="px-3 py-1.5 text-sm text-gray-700 whitespace-nowrap max-w-xs overflow-hidden text-ellipsis">${display}</td>`;
      }
      html += '</tr>';
    }
  }
  html += '</tbody>';
  tableEl.innerHTML = html;
}

// ── UI Helpers ─────────────────────────────────────────────────────────────
function updateDbStatus(status) {
  const el = $('db-status');
  const dot = el.querySelector('.status-dot');
  const text = el.querySelector('.status-text');
  if (status === 'loading') {
    dot.className = 'status-dot w-2 h-2 rounded-full bg-yellow-400 animate-pulse';
    text.textContent = 'Loading DuckDB…';
  } else if (status === 'ready') {
    dot.className = 'status-dot w-2 h-2 rounded-full bg-green-400';
    text.textContent = 'DuckDB Ready';
  } else {
    dot.className = 'status-dot w-2 h-2 rounded-full bg-red-500';
    text.textContent = 'DuckDB Error';
  }
}

function showToast(message, type = 'info') {
  const toast = $('toast');
  const colors = {
    success: 'bg-green-600',
    error: 'bg-red-600',
    warn: 'bg-yellow-500',
    info: 'bg-blue-600',
  };
  toast.className = `fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg text-white text-sm font-medium shadow-lg max-w-xs ${colors[type] || colors.info}`;
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toast._toastTimeout);
  toast._toastTimeout = setTimeout(() => { toast.hidden = true; }, 4500);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
