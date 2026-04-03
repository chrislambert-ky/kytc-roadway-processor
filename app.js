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

const state = {
  originalRows: [],
  workingRows: [],
  enrichedRows: [],
  headerMap: [],
  attributes: [],
  selectedAttributes: new Set(DEFAULT_ATTRIBUTES),
  previewTable: null,
  isProcessing: false,
  requestMode: 'async',
  logLines: [],
};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindUploadEvents();
  bindAttributeEvents();
  bindActionEvents();
  populateCoordinateSelectors([]);
  await loadAttributeCatalog();
  updateSelectionSummary();
  updateRequestModeHelp();
  clearProcessConsole();
  setProcessorIndicator('ready', 'Ready');
  updateProcessAvailability();
}

function bindUploadEvents() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (event) => {
    const [file] = event.target.files || [];
    if (file) handleFile(file);
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
  document.getElementById('attributeSearch').addEventListener('input', (event) => {
    renderAttributeTable(event.target.value);
  });

  document.getElementById('attributeTableBody').addEventListener('change', (event) => {
    if (!event.target.matches('.attr-checkbox')) return;
    const key = event.target.value;
    if (event.target.checked) {
      state.selectedAttributes.add(key);
    } else {
      state.selectedAttributes.delete(key);
    }
    updateSelectionSummary();
    updateProcessAvailability();
  });

  document.getElementById('defaultsBtn').addEventListener('click', () => {
    state.selectedAttributes = new Set(DEFAULT_ATTRIBUTES);
    renderAttributeTable(document.getElementById('attributeSearch').value);
    updateSelectionSummary();
    updateProcessAvailability();
  });

  document.getElementById('selectAllBtn').addEventListener('click', () => {
    state.selectedAttributes = new Set(state.attributes.map(attribute => attribute.key));
    renderAttributeTable(document.getElementById('attributeSearch').value);
    updateSelectionSummary();
    updateProcessAvailability();
  });

  document.getElementById('clearAllBtn').addEventListener('click', () => {
    state.selectedAttributes.clear();
    renderAttributeTable(document.getElementById('attributeSearch').value);
    updateSelectionSummary();
    updateProcessAvailability();
  });
}

function bindActionEvents() {
  document.getElementById('latSelect').addEventListener('change', updateProcessAvailability);
  document.getElementById('lonSelect').addEventListener('change', updateProcessAvailability);
  document.getElementById('processBtn').addEventListener('click', processCsv);
  document.getElementById('downloadBtn').addEventListener('click', downloadEnrichedCsv);

  const requestMode = document.getElementById('requestMode');
  state.requestMode = requestMode?.value || 'async';
  requestMode?.addEventListener('change', (event) => {
    state.requestMode = event.target.value;
    updateRequestModeHelp();
  });
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
        type: String(row['DATA TYPE'] || '').trim(),
        description: String(row.DESCRIPTION || '').trim(),
      }))
      .sort((left, right) => {
        const leftDefault = DEFAULT_ATTRIBUTES.includes(left.key) ? 0 : 1;
        const rightDefault = DEFAULT_ATTRIBUTES.includes(right.key) ? 0 : 1;
        if (leftDefault !== rightDefault) return leftDefault - rightDefault;
        return left.key.localeCompare(right.key);
      });

    renderAttributeTable();
  } catch (error) {
    state.attributes = DEFAULT_ATTRIBUTES.map(key => ({
      key,
      alias: key.replace(/_/g, ' '),
      type: '',
      description: 'Quick default roadway field.',
    }));

    renderAttributeTable();
    updateStatus('The full attribute list could not be loaded, but the quick defaults are ready.', 'warning');
  }
}

async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    updateStatus('Please upload a CSV file.', 'danger');
    return;
  }

  try {
    const csvText = await file.text();
    const rows = parseCSV(csvText);

    if (!rows.length) {
      throw new Error('No data rows were found in the file.');
    }

    const sourceHeaders = Object.keys(rows[0]);
    const headerMap = normalizeHeaderMap(sourceHeaders);
    const normalizedRows = rows.map(row => normalizeRow(row, headerMap));

    state.originalRows = rows;
    state.workingRows = normalizedRows;
    state.enrichedRows = [];
    state.headerMap = headerMap;
    document.getElementById('downloadBtn').disabled = true;

    const dropZone = document.getElementById('dropZone');
    dropZone.classList.add('has-file');
    dropZone.querySelector('.drop-zone-text').textContent = file.name;
    dropZone.querySelector('.drop-zone-subtext').textContent = `${rows.length.toLocaleString()} rows ready for preview`;

    document.getElementById('fileStatus').textContent = `${file.name} loaded · ${rows.length.toLocaleString()} rows`;
    document.getElementById('columnCount').textContent = `${headerMap.length} columns`;

    renderHeaderChips(headerMap);
    renderHeaderNotice(headerMap);
    populateCoordinateSelectors(headerMap.map(item => item.normalized));
    renderPreviewTable(normalizedRows, 'Original preview');
    clearProcessConsole();
    logProcessConsole(`Loaded ${file.name} with ${rows.length.toLocaleString()} row(s).`);
    if (headerMap.some(item => item.original !== item.normalized)) {
      logProcessConsole('Normalized one or more headers for compatibility.');
    }
    updateStatus(`Loaded ${rows.length.toLocaleString()} rows. Map the latitude and longitude fields, then process.`, 'success');
  } catch (error) {
    state.originalRows = [];
    state.workingRows = [];
    state.enrichedRows = [];
    state.headerMap = [];
    updateProcessAvailability();
    updateStatus(error.message || 'The CSV could not be read.', 'danger');
  }
}

function renderHeaderChips(headerMap) {
  const container = document.getElementById('headerChips');

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
  const changed = headerMap.filter(item => item.original !== item.normalized);

  if (!changed.length) {
    note.classList.add('d-none');
    note.textContent = '';
    return;
  }

  const preview = changed
    .slice(0, 5)
    .map(item => `${item.original} → ${item.normalized}`)
    .join(' · ');

  note.classList.remove('d-none');
  note.innerHTML = `<strong>Headers normalized:</strong> ${escapeHtml(preview)}${changed.length > 5 ? ' …' : ''}`;
}

function populateCoordinateSelectors(headers) {
  const latSelect = document.getElementById('latSelect');
  const lonSelect = document.getElementById('lonSelect');

  const options = ['<option value="">— select a column —</option>']
    .concat(headers.map(header => `<option value="${escapeAttribute(header)}">${escapeHtml(header)}</option>`));

  latSelect.innerHTML = options.join('');
  lonSelect.innerHTML = options.join('');

  const guessedLat = guessCoordinateField(headers, ['latitude', 'lat', 'ycoord', 'y_coordinate']);
  const guessedLon = guessCoordinateField(headers, ['longitude', 'lon', 'lng', 'xcoord', 'x_coordinate']);

  if (guessedLat) latSelect.value = guessedLat;
  if (guessedLon) lonSelect.value = guessedLon;

  updateProcessAvailability();
}

function renderAttributeTable(filterText = '') {
  const tbody = document.getElementById('attributeTableBody');
  const term = String(filterText || '').trim().toLowerCase();

  const filtered = state.attributes.filter(attribute => {
    if (!term) return true;
    return [attribute.key, attribute.alias, attribute.description, attribute.type]
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(term));
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-secondary py-4">No attributes match that filter.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(attribute => {
    const isDefault = DEFAULT_ATTRIBUTES.includes(attribute.key);
    const checked = state.selectedAttributes.has(attribute.key) ? 'checked' : '';
    return `
      <tr>
        <td>
          <input class="form-check-input attr-checkbox" type="checkbox" value="${escapeAttribute(attribute.key)}" ${checked}>
        </td>
        <td>
          <div class="attribute-key">${escapeHtml(attribute.key)}</div>
          ${isDefault ? '<span class="badge text-bg-primary default-pill">default</span>' : ''}
        </td>
        <td>${escapeHtml(attribute.description || attribute.alias || '—')}</td>
        <td><span class="type-pill">${escapeHtml(attribute.type || '—')}</span></td>
      </tr>
    `;
  }).join('');
}

function updateSelectionSummary() {
  const selectedCount = state.selectedAttributes.size;
  document.getElementById('selectedCount').textContent = `${selectedCount} selected`;
}

function updateProcessAvailability() {
  const latField = document.getElementById('latSelect').value;
  const lonField = document.getElementById('lonSelect').value;
  const ready = Boolean(state.workingRows.length && latField && lonField && selectedAttributeList().length && !state.isProcessing);

  document.getElementById('processBtn').disabled = !ready;
}

function renderPreviewTable(rows, badgeText) {
  document.getElementById('previewBadge').textContent = `${badgeText} · ${rows.length.toLocaleString()} row(s)`;
  const container = document.getElementById('previewTable');

  if (state.previewTable) {
    state.previewTable.destroy();
    state.previewTable = null;
  }

  if (!rows.length) {
    container.innerHTML = '<div class="text-secondary py-4">No rows to preview.</div>';
    return;
  }

  const columns = [
    {
      title: '#',
      formatter: 'rownum',
      headerSort: false,
      frozen: true,
      hozAlign: 'right',
      headerHozAlign: 'right',
      width: 60,
      cssClass: 'row-number-cell'
    },
    ...collectColumns(rows).map(name => ({
      title: name,
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
        return value === null || value === undefined || value === '' ? '<span class="text-secondary">—</span>' : escapeHtml(String(value));
      }
    }))
  ];

  state.previewTable = new Tabulator(container, {
    data: rows,
    columns,
    layout: 'fitDataTable',
    responsiveLayout: false,
    movableColumns: true,
    resizableColumns: true,
    clipboard: true,
    clipboardCopyStyled: false,
    height: '460px',
    placeholder: 'No rows to preview.'
  });
}

async function processCsv() {
  const latField = document.getElementById('latSelect').value;
  const lonField = document.getElementById('lonSelect').value;
  const selectedKeys = selectedAttributeList();

  if (!latField || !lonField) {
    updateStatus('Choose both a latitude and longitude column before processing.', 'danger');
    return;
  }

  if (latField === lonField) {
    updateStatus('Latitude and longitude cannot use the same column.', 'danger');
    return;
  }

  if (!selectedKeys.length) {
    updateStatus('Select at least one roadway attribute to append.', 'danger');
    return;
  }

  state.requestMode = document.getElementById('requestMode').value || 'async';
  state.isProcessing = true;
  updateProcessAvailability();
  document.getElementById('downloadBtn').disabled = true;

  const total = state.workingRows.length;
  const startedAt = performance.now();

  clearProcessConsole();
  logProcessConsole(`Preparing ${total.toLocaleString()} row(s) for processing.`);
  logProcessConsole(`Mode: ${state.requestMode === 'async' ? 'Async batch / Promise.all' : 'Sequential / one-at-a-time'}.`);
  logProcessConsole(`Return keys: ${selectedKeys.join(', ')}`);
  updateStatus(`Processing ${total.toLocaleString()} row(s) using ${state.requestMode === 'async' ? 'async batches' : 'sequential requests'}…`, 'info');

  try {
    const summary = state.requestMode === 'sync'
      ? await processRowsSequential(latField, lonField, selectedKeys)
      : await processRowsAsync(latField, lonField, selectedKeys);

    state.enrichedRows = summary.outputRows;
    renderPreviewTable(summary.outputRows, 'Enriched preview');
    document.getElementById('downloadBtn').disabled = !summary.outputRows.length;

    const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(2);
    const tone = summary.issueCount ? 'warning' : 'success';
    const suffix = summary.issueCount ? ` ${summary.issueCount.toLocaleString()} row(s) need review in the KYTC_Status column.` : '';

    logProcessConsole(`Completed in ${elapsedSeconds}s. Success: ${summary.successCount}. Issues: ${summary.issueCount}.`);
    updateStatus(`Finished ${total.toLocaleString()} row(s) in ${elapsedSeconds}s. ${summary.successCount.toLocaleString()} succeeded.${suffix}`, tone);
  } finally {
    state.isProcessing = false;
    updateProcessAvailability();
  }
}

async function processRowsSequential(latField, lonField, selectedKeys) {
  const outputRows = [];
  let successCount = 0;
  let issueCount = 0;

  for (let index = 0; index < state.workingRows.length; index += 1) {
    const result = await enrichRow(state.workingRows[index], index, latField, lonField, selectedKeys);
    outputRows.push(result.row);
    if (result.ok) successCount += 1;
    else issueCount += 1;

    if ((index + 1) % 10 === 0 || index === state.workingRows.length - 1) {
      const processed = index + 1;
      updateStatus(`Processed ${processed.toLocaleString()} of ${state.workingRows.length.toLocaleString()} row(s)…`, 'info');
      logProcessConsole(`Sequential progress: ${processed.toLocaleString()} / ${state.workingRows.length.toLocaleString()}`);
    }
  }

  return { outputRows, successCount, issueCount };
}

async function processRowsAsync(latField, lonField, selectedKeys) {
  const total = state.workingRows.length;
  const outputRows = [];
  let successCount = 0;
  let issueCount = 0;
  const batchSize = total >= 500 ? 10 : total >= 150 ? 8 : 6;

  logProcessConsole(`Async batch size: ${batchSize}`);

  for (let start = 0; start < total; start += batchSize) {
    const batch = state.workingRows.slice(start, start + batchSize);
    const results = await Promise.all(
      batch.map((row, index) => enrichRow(row, start + index, latField, lonField, selectedKeys))
    );

    results.forEach(result => {
      outputRows.push(result.row);
      if (result.ok) successCount += 1;
      else issueCount += 1;
    });

    const processed = Math.min(start + batch.length, total);
    updateStatus(`Processed ${processed.toLocaleString()} of ${total.toLocaleString()} row(s)…`, 'info');
    logProcessConsole(`Async progress: ${processed.toLocaleString()} / ${total.toLocaleString()}`);
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
        KYTC_Status: 'Invalid latitude/longitude',
        KYTC_Error: 'Row skipped before request.'
      }
    };
  }

  try {
    const payload = await fetchRouteInfo(lon, lat, selectedKeys, index + 1);
    const routeInfo = extractRouteInfo(payload);

    if (!routeInfo) {
      return {
        ok: false,
        row: {
          ...row,
          KYTC_Status: 'No route info returned',
          KYTC_Error: 'The API returned no Route_Info payload.'
        }
      };
    }

    const merged = { ...row };
    selectedKeys.forEach(key => {
      merged[key] = routeInfo[key] ?? '';
    });
    merged.Request_Id = `row-${index + 1}`;
    merged.KYTC_Status = 'OK';
    merged.KYTC_Error = '';

    return { ok: true, row: merged };
  } catch (error) {
    return {
      ok: false,
      row: {
        ...row,
        Request_Id: `row-${index + 1}`,
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

function downloadEnrichedCsv() {
  if (!state.enrichedRows.length) return;

  const columns = collectColumns(state.enrichedRows);
  const lines = [columns.map(escapeCsv).join(',')];

  state.enrichedRows.forEach(row => {
    const values = columns.map(column => escapeCsv(row[column] ?? ''));
    lines.push(values.join(','));
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `kytc-roadway-enriched-${stamp}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function selectedAttributeList() {
  return state.attributes
    .map(attribute => attribute.key)
    .filter(key => state.selectedAttributes.has(key));
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

function guessCoordinateField(headers, candidates) {
  const lowered = headers.map(header => ({ raw: header, value: String(header).toLowerCase() }));

  for (const candidate of candidates) {
    const exact = lowered.find(header => header.value === candidate);
    if (exact) return exact.raw;
  }

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
  el.className = `status-banner ${tone}`;
  el.textContent = message;

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

function clearProcessConsole() {
  state.logLines = [];
  const el = document.getElementById('processConsole');
  if (el) el.textContent = 'Request log will appear here after you load a CSV.';
}

function logProcessConsole(message) {
  const el = document.getElementById('processConsole');
  if (!el) return;

  const stamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  state.logLines.push(`[${stamp}] ${message}`);
  state.logLines = state.logLines.slice(-60);
  el.textContent = state.logLines.join('\n');
  el.scrollTop = el.scrollHeight;
}

function updateRequestModeHelp() {
  const el = document.getElementById('requestModeHelp');
  if (!el) return;

  el.textContent = state.requestMode === 'async'
    ? 'Translated from the Python async example: batched browser requests with retry and progress logging.'
    : 'Translated from the Python sync example: one request at a time for simpler troubleshooting.';
}

function parseNumber(value) {
  if (value === null || value === undefined) return Number.NaN;
  const cleaned = String(value).trim();
  if (!cleaned) return Number.NaN;
  return Number(cleaned);
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
