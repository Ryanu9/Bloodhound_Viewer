const crypto = require('crypto');
const path = require('path');

const AdmZip = require('adm-zip');

const { TITLE_PAIRS } = require('../config/columns');
const {
  buildComputersByOs,
  buildObjectDetailData,
  buildUsersByGroup,
  datasetKeyFromName,
  loadJsonEntriesFromText,
  normalizeComputers,
  normalizeDomains,
  normalizeGroups,
  normalizeUsers,
} = require('../lib/bloodhound');
const { createHttpError } = require('../lib/http-error');

function decodeBuffer(buffer) {
  return Buffer.isBuffer(buffer) ? buffer.toString('utf8').replace(/^\uFEFF/, '') : String(buffer ?? '').replace(/^\uFEFF/, '');
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatNowUtcPlus8() {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())} ${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}`;
}

function scanName(filenames) {
  const seen = [];

  for (const filename of filenames) {
    const normalizedName = String(filename || '').replace(/\\/g, '/');
    const baseName = path.posix.basename(normalizedName);
    const match = baseName.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})_/);
    const label = match
      ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`
      : path.posix.parse(baseName).name;

    if (label && !seen.includes(label)) {
      seen.push(label);
    }
  }

  return seen.length ? seen.join(', ') : 'Dataset';
}

function ingestPairs(pairs) {
  const raw = {
    users: [],
    groups: [],
    computers: [],
    domains: [],
  };

  for (const pair of pairs) {
    const filename = String(pair.filename || 'unknown.json');
    const content = Buffer.isBuffer(pair.content) ? pair.content : Buffer.from(pair.content || '');
    const lowerName = filename.toLowerCase();

    if (lowerName.endsWith('.zip')) {
      let archive;
      try {
        archive = new AdmZip(content);
      } catch {
        throw createHttpError(400, `Invalid ZIP: ${filename}`);
      }

      const entries = archive
        .getEntries()
        .filter((entry) => !entry.isDirectory)
        .sort((left, right) => left.entryName.localeCompare(right.entryName, undefined, { sensitivity: 'base' }));

      for (const entry of entries) {
        const key = datasetKeyFromName(path.posix.basename(entry.entryName));
        if (!key) {
          continue;
        }
        raw[key].push(...loadJsonEntriesFromText(decodeBuffer(entry.getData())));
      }
      continue;
    }

    if (lowerName.endsWith('.json')) {
      const key = datasetKeyFromName(path.basename(filename));
      if (key) {
        raw[key].push(...loadJsonEntriesFromText(decodeBuffer(content)));
      }
    }
  }

  const users = normalizeUsers(raw.users);
  const groups = normalizeGroups(raw.groups);
  const computers = normalizeComputers(raw.computers);
  const domains = normalizeDomains(raw.domains);

  if (![users, groups, computers, domains].some((rows) => rows.length > 0)) {
    throw createHttpError(
      400,
      '未识别到有效数据。请上传 BloodHound 格式的 JSON 文件 （文件名需以 _users/_groups/_computers/_domains.json 结尾）或包含这些文件的 ZIP。'
    );
  }

  const objectDetails = buildObjectDetailData(raw.users, raw.groups, raw.computers, raw.domains, users, groups, computers, domains, TITLE_PAIRS);
  const allDomains = [...new Set([...users, ...groups, ...computers, ...domains].map((row) => row.domain || '').filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: 'base' })
  );

  return {
    id: crypto.randomBytes(6).toString('hex'),
    name: scanName(pairs.map((pair) => pair.filename)),
    uploaded_at: formatNowUtcPlus8(),
    note: '',
    users,
    groups,
    computers,
    domains,
    object_details: objectDetails,
    all_domains: allDomains,
  };
}

module.exports = {
  buildComputersByOs,
  buildUsersByGroup,
  ingestPairs,
};
