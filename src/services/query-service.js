function filterDomain(rows, csv) {
  if (!csv) {
    return rows;
  }

  const wanted = new Set(
    String(csv)
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );

  if (!wanted.size) {
    return rows;
  }

  return rows.filter((row) => wanted.has(String(row.domain || '').toLowerCase()));
}

function columnQueryValues(row, key) {
  if (String(key) === 'sid') {
    const fullSid = String(row?.sid_full ?? '').trim();
    const rid = String(row?.sid ?? '').trim();
    const values = [];
    if (fullSid) {
      values.push(fullSid);
    }
    if (rid && !values.includes(rid)) {
      values.push(rid);
    }
    return values.length ? values : [''];
  }

  return [String(row?.[key] ?? '').trim()];
}

function primaryColumnQueryValue(row, key) {
  return columnQueryValues(row, key)[0] || '';
}

function filterSearch(rows, query, columns) {
  if (!query) {
    return rows;
  }

  const text = String(query).toLowerCase();
  const keys = columns.map((column) => column.key);

  return rows.filter((row) => keys.some((key) =>
    columnQueryValues(row, key).some((value) => String(value).toLowerCase().includes(text))
  ));
}

function applyFilterMap(rows, filterMap) {
  let filteredRows = rows;

  for (const [key, value] of Object.entries(filterMap || {})) {
    if (!value || (Array.isArray(value) && value.length === 0)) {
      continue;
    }

    if (Array.isArray(value)) {
      const wanted = new Set(value.map((item) => String(item).trim()));
      filteredRows = filteredRows.filter((row) => columnQueryValues(row, key).some((item) => wanted.has(String(item).trim())));
      continue;
    }

    const text = String(value).toLowerCase();
    filteredRows = filteredRows.filter((row) =>
      columnQueryValues(row, key).some((item) => String(item).toLowerCase().includes(text))
    );
  }

  return filteredRows;
}

function filterColumns(rows, rawJson) {
  if (!rawJson) {
    return rows;
  }

  try {
    return applyFilterMap(rows, JSON.parse(rawJson));
  } catch {
    return rows;
  }
}

function normalizeSortValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { kind: 0, number: value, text: '' };
  }

  const text = String(value ?? '').trim();
  if (!text) {
    return { kind: 1, number: 0, text: '' };
  }

  if (/^[-+]?\d+$/.test(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) {
      return { kind: 0, number, text: '' };
    }
  }

  return { kind: 1, number: 0, text: text.toLowerCase() };
}

function compareSortValues(left, right) {
  if (left.kind !== right.kind) {
    return left.kind - right.kind;
  }

  if (left.kind === 0) {
    return left.number - right.number;
  }

  if (left.text < right.text) {
    return -1;
  }

  if (left.text > right.text) {
    return 1;
  }

  return 0;
}

function sortRows(rows, key, order) {
  if (!key) {
    return rows;
  }

  const direction = String(order).toLowerCase() === 'desc' ? -1 : 1;

  return [...rows].sort((left, right) => {
    const result = compareSortValues(normalizeSortValue(left[key]), normalizeSortValue(right[key]));
    return result * direction;
  });
}

module.exports = {
  applyFilterMap,
  filterColumns,
  filterDomain,
  filterSearch,
  primaryColumnQueryValue,
  sortRows,
};
