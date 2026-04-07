export function makeTabState() {
  return {
    columns: [],
    hiddenKeys: new Set(),
    rows: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    sortKey: '',
    sortOrder: 'asc',
    search: '',
    showFilterRow: false,
    columnFilters: {},
  };
}
