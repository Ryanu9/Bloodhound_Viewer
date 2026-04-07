const fs = require('fs/promises');
const path = require('path');

const { normalizeSid, ridFromSid } = require('../lib/bloodhound');
const { createHttpError } = require('../lib/http-error');

function countTypes(dataset) {
  return {
    users: (dataset.users || []).length,
    groups: (dataset.groups || []).length,
    computers: (dataset.computers || []).length,
    domains: (dataset.domains || []).length,
  };
}

const DATASET_KEYS = ['users', 'groups', 'computers', 'domains'];
const SID_DATASET_KEYS = new Set(['users', 'groups', 'computers']);

function normalizeRow(row, dataType) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return row;
  }

  const next = { ...row };
  if (SID_DATASET_KEYS.has(dataType)) {
    const sidFull = normalizeSid(next.sid_full || next.object_id || next.sid);
    next.sid_full = sidFull;
    next.sid = sidFull ? ridFromSid(sidFull) : String(next.sid || '').trim();
  }

  return next;
}

function rowIdentity(row, dataType) {
  if (!row || typeof row !== 'object') {
    return '';
  }

  if (SID_DATASET_KEYS.has(dataType)) {
    const sidIdentity = normalizeSid(row.sid_full || row.object_id || row.sid);
    if (sidIdentity) {
      return sidIdentity;
    }
  }

  const domainSid = normalizeSid(row.domainsid);
  if (domainSid) {
    return domainSid;
  }

  const objectId = String(row.object_id || '').trim();
  if (objectId) {
    return objectId;
  }

  const objectGuid = String(row.objectguid || '').trim();
  if (objectGuid) {
    return objectGuid;
  }

  return String(row.name || row.samaccountname || '').trim().toLowerCase();
}

function dedupeRows(rows, dataType) {
  const seen = new Set();
  const uniqueRows = [];

  for (const row of rows || []) {
    const normalizedRow = normalizeRow(row, dataType);
    const identity = rowIdentity(normalizedRow, dataType);
    if (identity && seen.has(identity)) {
      continue;
    }
    if (identity) {
      seen.add(identity);
    }
    uniqueRows.push(normalizedRow);
  }

  return uniqueRows;
}

function normalizeDetailObject(detail, row) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail) || !row) {
    return detail;
  }

  const sidFull = normalizeSid(row.sid_full || row.object_id || row.sid);
  if (!sidFull) {
    return detail;
  }

  const info = Array.isArray(detail.info) ? detail.info.map((item) => ({ ...item })) : [];
  const sidItem = info.find((item) => item && item.label === 'SID');
  if (sidItem) {
    sidItem.value = sidFull;
  } else {
    const insertAfterSam = info.findIndex((item) => item && item.label === 'SAM Name');
    const insertAfterName = info.findIndex((item) => item && item.label === 'Name');
    const insertIndex = insertAfterSam >= 0 ? insertAfterSam + 1 : insertAfterName >= 0 ? insertAfterName + 1 : info.length;
    info.splice(insertIndex, 0, { label: 'SID', value: sidFull });
  }

  return {
    ...detail,
    info,
  };
}

function normalizeDataset(dataset) {
  if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) {
    return dataset;
  }

  const normalized = {
    ...dataset,
  };

  for (const key of DATASET_KEYS) {
    normalized[key] = dedupeRows(dataset[key], key);
  }

  normalized.all_domains = [...new Set((normalized.all_domains || []).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));

  const rowLookup = {};
  for (const key of DATASET_KEYS) {
    for (const row of normalized[key] || []) {
      if (row && row.object_id) {
        rowLookup[row.object_id] = row;
      }
    }
  }

  const details = normalized.object_details && typeof normalized.object_details === 'object' && !Array.isArray(normalized.object_details)
    ? normalized.object_details
    : {};
  const objects = details.objects && typeof details.objects === 'object' && !Array.isArray(details.objects)
    ? details.objects
    : {};

  normalized.object_details = {
    ...details,
    objects: Object.fromEntries(
      Object.entries(objects).map(([objectId, detail]) => [objectId, normalizeDetailObject(detail, rowLookup[objectId])])
    ),
  };

  return normalized;
}

class DatasetStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.store = new Map();
  }

  async init() {
    await fs.mkdir(this.dataDir, { recursive: true });
    const entries = await fs.readdir(this.dataDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
        continue;
      }

      const filePath = path.join(this.dataDir, entry.name);
      try {
        const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if (payload && payload.id) {
          this.store.set(payload.id, normalizeDataset(payload));
        }
      } catch {
      }
    }
  }

  datasetPath(datasetId) {
    return path.join(this.dataDir, `${datasetId}.json`);
  }

  async saveDataset(dataset) {
    const normalized = normalizeDataset(dataset);
    this.store.set(normalized.id, normalized);
    await fs.writeFile(this.datasetPath(normalized.id), JSON.stringify(normalized), 'utf8');
    return normalized;
  }

  async deleteDataset(datasetId) {
    this.store.delete(datasetId);
    await fs.rm(this.datasetPath(datasetId), { force: true });
  }

  listDatasets() {
    return [...this.store.values()].map((dataset) => ({
      id: dataset.id,
      name: dataset.name,
      uploaded_at: dataset.uploaded_at,
      note: dataset.note || '',
      counts: countTypes(dataset),
      all_domains: dataset.all_domains || [],
    }));
  }

  getDataset(datasetId) {
    if (String(datasetId).includes(',')) {
      return this.mergeDatasets(datasetId);
    }

    const dataset = this.store.get(datasetId);
    if (!dataset) {
      throw createHttpError(404, 'Dataset not found');
    }
    return dataset;
  }

  mergeDatasets(datasetId) {
    const ids = String(datasetId)
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    const merged = {
      id: datasetId,
      name: '',
      users: [],
      groups: [],
      computers: [],
      domains: [],
      object_details: {},
      all_domains: [],
    };

    const seenDomains = new Set();
    const names = [];

    for (const id of ids) {
      const dataset = this.store.get(id);
      if (!dataset) {
        continue;
      }

      names.push(dataset.name || id);
      for (const key of DATASET_KEYS) {
        merged[key].push(...(dataset[key] || []));
      }

      const otherDetails = dataset.object_details || {};
      const otherObjects = otherDetails.objects || {};
      merged.object_details.objects = {
        ...(merged.object_details.objects || {}),
        ...otherObjects,
      };

      for (const [key, value] of Object.entries(otherDetails)) {
        if (key !== 'objects') {
          merged.object_details[key] = value;
        }
      }

      for (const domain of dataset.all_domains || []) {
        if (!seenDomains.has(domain)) {
          seenDomains.add(domain);
          merged.all_domains.push(domain);
        }
      }
    }

    for (const key of DATASET_KEYS) {
      merged[key] = dedupeRows(merged[key], key);
    }

    merged.all_domains.sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
    merged.name = names.length ? names.join(' + ') : '未知';

    if (!DATASET_KEYS.some((key) => (merged[key] || []).length > 0)) {
      throw createHttpError(404, 'No valid datasets found');
    }

    return normalizeDataset(merged);
  }

  async updateNote(datasetId, note) {
    const dataset = this.store.get(datasetId);
    if (!dataset) {
      throw createHttpError(404, 'Dataset not found');
    }

    dataset.note = String(note || '').slice(0, 200);
    await this.saveDataset(dataset);
    return dataset;
  }
}

module.exports = {
  DatasetStore,
  countTypes,
};
