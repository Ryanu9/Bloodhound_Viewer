const express = require('express');
const multer = require('multer');

const { ALL_COLUMNS } = require('../config/columns');
const { createHttpError } = require('../lib/http-error');
const { buildComputersByOs, buildUsersByGroup, ingestPairs } = require('../services/ingest-service');
const { applyFilterMap, filterColumns, filterDomain, filterSearch, primaryColumnQueryValue, sortRows } = require('../services/query-service');
const { countTypes } = require('../store/dataset-store');

function createApiRouter({ store }) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage() });

  function asyncRoute(handler) {
    return (req, res, next) => {
      Promise.resolve(handler(req, res, next)).catch(next);
    };
  }

  function parseClampedInt(value, fallback, minimum, maximum) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (Number.isNaN(parsed)) {
      return fallback;
    }
    return Math.max(minimum, Math.min(maximum, parsed));
  }

  function ensureDataType(dataType) {
    if (!ALL_COLUMNS[dataType]) {
      throw createHttpError(400, `Invalid type: ${dataType}`);
    }
    return ALL_COLUMNS[dataType];
  }

  router.post(
    '/upload',
    upload.array('files'),
    asyncRoute(async (req, res) => {
      const files = req.files || [];
      if (!files.length) {
        throw createHttpError(400, '未上传任何文件');
      }

      const dataset = ingestPairs(
        files.map((file) => ({
          filename: file.originalname || 'unknown.json',
          content: file.buffer,
        }))
      );

      await store.saveDataset(dataset);
      res.json({
        id: dataset.id,
        name: dataset.name,
        all_domains: dataset.all_domains,
        counts: countTypes(dataset),
      });
    })
  );

  router.get(
    '/datasets',
    asyncRoute(async (_req, res) => {
      res.json(store.listDatasets());
    })
  );

  router.patch(
    '/datasets/:datasetId/note',
    asyncRoute(async (req, res) => {
      await store.updateNote(req.params.datasetId, req.body?.note);
      res.json({ ok: true });
    })
  );

  router.delete(
    '/datasets/:datasetId',
    asyncRoute(async (req, res) => {
      await store.deleteDataset(req.params.datasetId);
      res.json({ ok: true });
    })
  );

  router.get(
    '/datasets/:datasetId/summary',
    asyncRoute(async (req, res) => {
      const dataset = store.getDataset(req.params.datasetId);
      const domains = String(req.query.domains || '');
      const counts = {
        users: filterDomain(dataset.users || [], domains).length,
        groups: filterDomain(dataset.groups || [], domains).length,
        computers: filterDomain(dataset.computers || [], domains).length,
        domains: filterDomain(dataset.domains || [], domains).length,
      };
      res.json({
        counts,
        all_domains: dataset.all_domains || [],
        name: dataset.name,
      });
    })
  );

  router.get(
    '/datasets/:datasetId/data/:dataType',
    asyncRoute(async (req, res) => {
      const columns = ensureDataType(req.params.dataType);
      const dataset = store.getDataset(req.params.datasetId);
      const page = parseClampedInt(req.query.page, 1, 1, Number.MAX_SAFE_INTEGER);
      const pageSize = parseClampedInt(req.query.page_size, 50, 1, 1000);
      const sortKey = String(req.query.sort || '');
      const order = String(req.query.order || 'asc');
      const search = String(req.query.search || '');
      const domains = String(req.query.domains || '');
      const filters = String(req.query.filters || '');

      let rows = dataset[req.params.dataType] || [];
      rows = filterDomain(rows, domains);
      rows = filterSearch(rows, search, columns);
      rows = filterColumns(rows, filters);
      rows = sortRows(rows, sortKey, order);

      const total = rows.length;
      const start = (page - 1) * pageSize;
      res.json({
        columns,
        rows: rows.slice(start, start + pageSize),
        total,
        page,
        page_size: pageSize,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
      });
    })
  );

  router.get(
    '/datasets/:datasetId/data/:dataType/distinct',
    asyncRoute(async (req, res) => {
      const dataType = req.params.dataType;
      const columns = ensureDataType(dataType);
      const dataset = store.getDataset(req.params.datasetId);
      const column = String(req.query.column || '');
      const search = String(req.query.search || '');
      const domains = String(req.query.domains || '');
      const filters = String(req.query.filters || '');

      if (!column) {
        throw createHttpError(400, 'Missing column');
      }

      let rows = dataset[dataType] || [];
      rows = filterDomain(rows, domains);
      rows = filterSearch(rows, search, columns);

      if (filters) {
        try {
          const filterMap = JSON.parse(filters);
          delete filterMap[column];
          rows = applyFilterMap(rows, filterMap);
        } catch {
        }
      }

      const counts = {};
      let emptyCount = 0;

      for (const row of rows) {
        const value = String(primaryColumnQueryValue(row, column) ?? '').trim();
        if (!value) {
          emptyCount += 1;
          continue;
        }
        counts[value] = (counts[value] || 0) + 1;
      }

      const values = Object.keys(counts).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
      const resultCounts = Object.fromEntries(values.map((value) => [value, counts[value]]));

      if (emptyCount) {
        values.unshift('');
        resultCounts[''] = emptyCount;
      }

      res.json({
        column,
        values,
        counts: resultCounts,
      });
    })
  );

  router.get(
    '/datasets/:datasetId/object/*',
    asyncRoute(async (req, res) => {
      const dataset = store.getDataset(req.params.datasetId);
      const objectId = req.params[0] || '';
      const objectDetail = dataset.object_details?.objects?.[objectId];
      if (!objectDetail) {
        throw createHttpError(404, 'Object not found');
      }
      res.json(objectDetail);
    })
  );

  router.get(
    '/datasets/:datasetId/users-by-group',
    asyncRoute(async (req, res) => {
      const dataset = store.getDataset(req.params.datasetId);
      const domains = String(req.query.domains || '');
      const groups = filterDomain(dataset.groups || [], domains);
      const users = filterDomain(dataset.users || [], domains);
      res.json(
        buildUsersByGroup(groups, users).map(([group, members]) => ({
          group: {
            name: group.name,
            domain: group.domain || '',
            object_id: group.object_id || '',
          },
          member_count: members.length,
          members,
        }))
      );
    })
  );

  router.get(
    '/datasets/:datasetId/computers-by-os',
    asyncRoute(async (req, res) => {
      const dataset = store.getDataset(req.params.datasetId);
      const domains = String(req.query.domains || '');
      const computers = filterDomain(dataset.computers || [], domains);
      res.json(
        buildComputersByOs(computers).map(([os, rows]) => ({
          os,
          count: rows.length,
          computers: rows,
        }))
      );
    })
  );

  return router;
}

module.exports = {
  createApiRouter,
};
