/* ===================================================================
   BloodHound Viewer — Vue 3 Composition API (CDN, no build)
   =================================================================== */
import { api, debounce } from './js/api.js';
import { ObjectLabel } from './js/object-label.js';
import { makeTabState } from './js/tab-state.js';

const { createApp, ref, reactive, computed, watch, onMounted, onBeforeUnmount, nextTick } = window.Vue;

/* ---------- object-label component ---------- */

/* ---------- helpers ---------- */

/* ---------- main app ---------- */
const app = createApp({
  setup() {
    /* ---- state ---- */
    const loading = ref(false);
    // Delayed visibility to avoid "flash" on fast requests (<250ms)
    const loadingVisible = ref(false);
    let loadingTimer = null;
    watch(loading, (v) => {
      if (v) {
        if (loadingTimer) return;
        loadingTimer = setTimeout(() => {
          loadingVisible.value = true;
          loadingTimer = null;
        }, 250);
      } else {
        if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
        loadingVisible.value = false;
      }
    });
    const uploading = ref(false);
    const dragging = ref(false);
    const loadedDatasetIds = ref([]);     // active dataset IDs
    const datasetName = computed(() => {
      const loaded = datasets.value.filter(d => loadedDatasetIds.value.includes(d.id));
      if (!loaded.length) return '';
      return loaded.map(d => d.note || d.name).join(' + ');
    });
    const datasets = ref([]);
    const allDomains = ref([]);
    const checkedDomains = ref([]);
    const showDomainDropdown = ref(false);
    const showDatasetSelector = ref(false);
    const showUploadModal = ref(false);
    const counts = reactive({ users: 0, groups: 0, computers: 0, domains: 0 });
    const currentTab = ref('dashboard');
    const showColManager = ref(false);
    const groupedData = ref([]);

    // computed: comma-separated dataset IDs for API calls
    const mergedId = computed(() => loadedDatasetIds.value.join(','));
    const hasData = computed(() => loadedDatasetIds.value.length > 0);

    // detail
    const detailVisible = ref(false);
    const detailStack = ref([]);
    const currentDetail = ref(null);
    const activeRelKey = ref('');

    // context menu
    const ctxMenu = reactive({ visible: false, x: 0, y: 0, objectId: '', meta: null });

    // favorites (persisted in localStorage, dataset-agnostic)
    const FAV_STORAGE_KEY = 'bh_viewer_favorites';
    const favorites = ref([]);
    function loadFavorites() {
      try {
        const raw = localStorage.getItem(FAV_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        favorites.value = Array.isArray(parsed) ? parsed : [];
      } catch {
        favorites.value = [];
      }
    }
    function persistFavorites() {
      try { localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(favorites.value)); } catch {}
    }
    function isFavorite(oid) {
      return !!oid && favorites.value.some(f => f.object_id === oid);
    }
    function addFavorite(meta) {
      const oid = meta && meta.object_id;
      if (!oid || isFavorite(oid)) return;
      favorites.value = [
        {
          object_id: oid,
          name: meta.name || oid,
          type: meta.type || '',
          domain: meta.domain || '',
          description: meta.description || '',
          added_at: Date.now(),
        },
        ...favorites.value,
      ];
      persistFavorites();
    }
    function removeFavorite(oid) {
      if (!oid) return;
      favorites.value = favorites.value.filter(f => f.object_id !== oid);
      persistFavorites();
    }
    function toggleFavorite(meta) {
      if (!meta || !meta.object_id) return;
      if (isFavorite(meta.object_id)) removeFavorite(meta.object_id);
      else addFavorite(meta);
    }
    function updateFavoriteNote(oid, note) {
      if (!oid) return;
      const idx = favorites.value.findIndex(f => f.object_id === oid);
      if (idx < 0) return;
      const next = favorites.value.slice();
      next[idx] = { ...next[idx], note: String(note || '') };
      favorites.value = next;
      persistFavorites();
    }
    function formatFavoriteTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return '';
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // favorites table column widths (persisted)
    const FAV_COL_WIDTHS_KEY = 'bh_viewer_fav_col_widths';
    const favColWidths = reactive({
      name: 260,
      type: 100,
      domain: 180,
      description: 0, // 0 means auto-flex (remaining space)
      note: 220,
      added_at: 160,
      action: 60,
    });
    function loadFavColWidths() {
      try {
        const raw = localStorage.getItem(FAV_COL_WIDTHS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          Object.keys(parsed).forEach((k) => {
            if (k in favColWidths && Number.isFinite(parsed[k])) favColWidths[k] = parsed[k];
          });
        }
      } catch {}
    }
    function persistFavColWidths() {
      try { localStorage.setItem(FAV_COL_WIDTHS_KEY, JSON.stringify({ ...favColWidths })); } catch {}
    }
    function favColStyle(key) {
      const w = favColWidths[key];
      if (!w || w <= 0) return {};
      const px = `${w}px`;
      return { width: px, minWidth: px, maxWidth: px };
    }
    let favResizeCol = null;
    let favResizeStartX = 0;
    let favResizeStartW = 0;
    function onFavResizeMove(e) {
      if (!favResizeCol) return;
      const dx = e.clientX - favResizeStartX;
      favColWidths[favResizeCol] = Math.max(40, Math.round(favResizeStartW + dx));
    }
    function onFavResizeEnd() {
      if (!favResizeCol) return;
      favResizeCol = null;
      document.removeEventListener('mousemove', onFavResizeMove);
      document.removeEventListener('mouseup', onFavResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      persistFavColWidths();
    }
    function onFavResizeStart(colKey, e) {
      e.preventDefault();
      e.stopPropagation();
      favResizeCol = colKey;
      favResizeStartX = e.clientX;
      const th = e.target.closest('th');
      favResizeStartW = th ? th.offsetWidth : (favColWidths[colKey] || 100);
      document.addEventListener('mousemove', onFavResizeMove);
      document.addEventListener('mouseup', onFavResizeEnd);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    // per-tab data
    const savedTabs = {};
    const td = ref(makeTabState());

    // column drag state
    const dragFromIdx = ref(-1);
    const dragOverCol = ref('');

    // column resize state
    const colWidths = reactive({});
    const userSizedCols = reactive({});
    const tableWrapEl = ref(null);
    const tableViewportWidth = ref(0);
    let resizeCol = null, resizeStartX = 0, resizeStartW = 0;

    function parsePixelWidth(value, fallback = 0) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      const text = String(value || '').trim();
      if (!text) {
        return fallback;
      }
      const match = text.match(/^(\d+(?:\.\d+)?)px$/i);
      if (match) {
        return Number.parseFloat(match[1]);
      }
      const parsed = Number.parseFloat(text);
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    function toPixelWidth(value) {
      return `${Math.round(Math.max(0, value))}px`;
    }

    function updateTableViewportWidth() {
      const width = tableWrapEl.value && tableWrapEl.value.clientWidth
        ? tableWrapEl.value.clientWidth
        : 0;
      tableViewportWidth.value = Math.max(0, Math.floor(width));
    }

    function onResizeStart(colKey, e) {
      e.preventDefault();
      e.stopPropagation();
      resizeCol = colKey;
      resizeStartX = e.clientX;
      const th = e.target.closest('th');
      resizeStartW = th.offsetWidth;
      document.addEventListener('mousemove', onResizeMove);
      document.addEventListener('mouseup', onResizeEnd);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    function onResizeMove(e) {
      if (!resizeCol) return;
      const column = findColumn(resizeCol);
      const delta = e.clientX - resizeStartX;
      const minWidth = inferMinimumColumnWidth(column);
      const maxWidth = parsePixelWidth(inferMaxColumnWidth(column, { manual: true }), Math.max(minWidth, resizeStartW + delta));
      const newW = Math.min(maxWidth, Math.max(minWidth, resizeStartW + delta));
      colWidths[resizeCol] = newW + 'px';
      userSizedCols[resizeCol] = true;
    }
    function onResizeEnd() {
      resizeCol = null;
      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', onResizeEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    // filter popover state
    const popoverCol = ref('');           // which column's popover is open
    const popoverValues = ref([]);        // all distinct values for current column
    const popoverCounts = ref({});        // value → count
    const popoverChecked = ref(new Set());// currently checked values
    const popoverSearch = ref('');        // search within popover
    const popoverLoading = ref(false);
    const popoverEl = ref(null);
    const popoverAnchorEl = ref(null);
    const popoverPos = reactive({ top: '0px', left: '0px' }); // fixed position
    const popoverFiltered = computed(() => {
      const q = popoverSearch.value.toLowerCase();
      if (!q) return popoverValues.value;
      return popoverValues.value.filter(v => v === '' ? '(空白)'.includes(q) : v.toLowerCase().includes(q));
    });
    const popoverAllChecked = computed(() =>
      popoverFiltered.value.length > 0 && popoverFiltered.value.every(v => popoverChecked.value.has(v))
    );

    function clampPopoverCoord(value, minimum, maximum) {
      if (maximum < minimum) return minimum;
      return Math.min(Math.max(value, minimum), maximum);
    }

    function getPopoverNode() {
      if (Array.isArray(popoverEl.value)) {
        return popoverEl.value.find(Boolean) || null;
      }
      return popoverEl.value || null;
    }

    function updatePopoverPosition() {
      if (!popoverAnchorEl.value) return;
      const rect = popoverAnchorEl.value.getBoundingClientRect();
      const popoverNode = getPopoverNode();
      const margin = 8;
      const gap = 4;
      const popW = popoverNode ? popoverNode.offsetWidth : 360;
      const popH = popoverNode ? popoverNode.offsetHeight : 320;
      const maxLeft = window.innerWidth - popW - margin;
      const maxTop = window.innerHeight - popH - margin;
      const preferredRightAlignedLeft = rect.right - popW;
      const fallbackLeftAlignedLeft = rect.left;
      let left = preferredRightAlignedLeft;
      if (preferredRightAlignedLeft < margin) {
        left = fallbackLeftAlignedLeft;
      }
      let top = rect.bottom + gap;
      if (top + popH > window.innerHeight - margin) {
        top = rect.top - popH - gap;
      }
      popoverPos.left = `${Math.round(clampPopoverCoord(left, margin, maxLeft))}px`;
      popoverPos.top = `${Math.round(clampPopoverCoord(top, margin, maxTop))}px`;
    }

    const tabs = [
      { key: 'dashboard', label: '概览' },
      { key: 'users', label: '用户' },
      { key: 'groups', label: '组' },
      { key: 'computers', label: '计算机' },
      { key: 'domains', label: '域' },
      { key: 'users-by-group', label: '按组查看用户' },
      { key: 'computers-by-os', label: '按系统查看计算机' },
      { key: 'favorites', label: '收藏' },
    ];

    const tableTabs = ['users', 'groups', 'computers', 'domains'];
    const isTableTab = computed(() => tableTabs.includes(currentTab.value));

    const visCols = computed(() =>
      td.value.columns.filter(c => !td.value.hiddenKeys.has(c.key))
    );

    const dashCards = computed(() => [
      { tab: 'users', label: '用户', count: counts.users },
      { tab: 'groups', label: '组', count: counts.groups },
      { tab: 'computers', label: '计算机', count: counts.computers },
      { tab: 'domains', label: '域', count: counts.domains },
    ]);

    const activeRelTabs = computed(() => {
      if (!currentDetail.value || !currentDetail.value.relations) return [];
      const REL_LABELS = {
        memberof: 'Member Of', members: 'Members', adminto: 'Admin To',
        sessions: 'Sessions', local_admins: 'Local Admins', rdp: 'RDP',
        dcom: 'DCOM', ps_remote: 'PS Remote', outbound_control: 'Outbound Control',
        inbound_control: 'Inbound Control', delegations: 'Delegations',
        trusts: 'Trusts', gpo_links: 'GPO Links',
      };
      return Object.entries(currentDetail.value.relations)
        .filter(([, v]) => v && v.length)
        .map(([k, v]) => [k, REL_LABELS[k] || k]);
    });

    const pageRange = computed(() => {
      const t = td.value.totalPages;
      const p = td.value.page;
      const r = [];
      let lo = Math.max(1, p - 3), hi = Math.min(t, p + 3);
      if (hi - lo < 6) { lo = Math.max(1, hi - 6); hi = Math.min(t, lo + 6); }
      for (let i = lo; i <= hi; i++) r.push(i);
      return r;
    });

    /* ---- domain param ---- */
    function domainParam() {
      if (!allDomains.value.length) return '';
      if (checkedDomains.value.length === allDomains.value.length) return '';
      return checkedDomains.value.join(',');
    }

    /* ---- data fetching ---- */
    function refreshAllDomains() {
      const merged = new Set();
      for (const ds of datasets.value) {
        if (ds.all_domains) ds.all_domains.forEach(d => merged.add(d));
      }
      const sorted = [...merged].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      const prev = new Set(checkedDomains.value);
      allDomains.value = sorted;
      // always select all domains (including newly added ones)
      checkedDomains.value = [...sorted];
    }

    async function fetchSummary() {
      const d = domainParam();
      const s = await api(`/datasets/${mergedId.value}/summary?domains=${encodeURIComponent(d)}`);
      Object.assign(counts, s.counts);
    }

    async function fetchData() {
      if (!isTableTab.value) return;
      const s = td.value;
      const params = new URLSearchParams({
        page: s.page,
        page_size: s.pageSize,
        sort: s.sortKey,
        order: s.sortOrder,
        search: s.search,
        domains: domainParam(),
      });
      // column filters
      const cf = {};
      for (const [k, v] of Object.entries(s.columnFilters)) { if (v) cf[k] = v; }
      if (Object.keys(cf).length) params.set('filters', JSON.stringify(cf));

      const r = await api(`/datasets/${mergedId.value}/data/${currentTab.value}?${params}`);
      // first load: init hidden columns from default_visible
      const firstLoad = !s.columns.length;
      if (r.columns.length) {
        r.columns.forEach(c => {
          if (firstLoad && !c.default_visible) s.hiddenKeys.add(c.key);
          if (!colWidths[c.key]) colWidths[c.key] = inferDefaultColumnWidth(c);
        });
      }
      // Preserve user-adjusted column order across refetch: reuse existing order when keys match,
      // append any new columns from server, drop removed ones.
      if (!firstLoad && r.columns.length) {
        const serverByKey = new Map(r.columns.map((c) => [c.key, c]));
        const reordered = [];
        const seen = new Set();
        for (const prev of s.columns) {
          const fresh = serverByKey.get(prev.key);
          if (fresh) {
            reordered.push(fresh);
            seen.add(prev.key);
          }
        }
        for (const c of r.columns) {
          if (!seen.has(c.key)) reordered.push(c);
        }
        s.columns = reordered;
      } else {
        s.columns = r.columns;
      }
      s.rows = r.rows;
      s.total = r.total;
      s.page = r.page;
      s.totalPages = r.total_pages;
      await nextTick();
      updateTableViewportWidth();
    }

    async function fetchGrouped() {
      const tab = currentTab.value;
      const d = domainParam();
      let data;
      if (tab === 'users-by-group') {
        data = await api(`/datasets/${mergedId.value}/users-by-group?domains=${encodeURIComponent(d)}`);
      } else {
        data = await api(`/datasets/${mergedId.value}/computers-by-os?domains=${encodeURIComponent(d)}`);
      }
      data.forEach(s => { s._collapsed = false; });
      groupedData.value = data;
    }

    async function loadTab() {
      if (!mergedId.value) return;
      loading.value = true;
      try {
        await fetchSummary();
        if (isTableTab.value) await fetchData();
        else if (currentTab.value === 'users-by-group' || currentTab.value === 'computers-by-os') await fetchGrouped();
      } finally { loading.value = false; }
    }

    /* ---- tab switching ---- */
    function switchTab(key) {
      // save current tab state
      if (isTableTab.value) savedTabs[currentTab.value] = td.value;
      currentTab.value = key;
      showColManager.value = false;
      if (tableTabs.includes(key)) {
        td.value = savedTabs[key] || makeTabState();
      }
      loadTab();
    }

    /* ---- upload ---- */
    async function doUpload(fileList) {
      if (!fileList || !fileList.length) return;
      uploading.value = true;
      try {
        const fd = new FormData();
        for (const f of fileList) fd.append('files', f);
        const r = await api('/upload', { method: 'POST', body: fd });
        await loadDatasets();
        // auto-select newly uploaded dataset
        if (!loadedDatasetIds.value.includes(r.id)) {
          loadedDatasetIds.value = [...loadedDatasetIds.value, r.id];
        }
        refreshAllDomains();
        showUploadModal.value = false;
        currentTab.value = 'dashboard';
        loadTab();
      } finally { uploading.value = false; }
    }

    function onFileSelect(e) { doUpload(e.target.files); e.target.value = ''; }
    function onDrop(e) { dragging.value = false; doUpload(e.dataTransfer.files); }

    /* ---- datasets ---- */
    async function loadDatasets() {
      datasets.value = await api('/datasets');
    }

    function toggleDataset(dsId) {
      const ids = loadedDatasetIds.value;
      if (ids.includes(dsId)) {
        loadedDatasetIds.value = ids.filter(i => i !== dsId);
      } else {
        loadedDatasetIds.value = [...ids, dsId];
      }
      refreshAllDomains();
      if (loadedDatasetIds.value.length) loadTab();
    }

    function loadAllDatasets() {
      loadedDatasetIds.value = datasets.value.map(d => d.id);
      refreshAllDomains();
      loadTab();
    }

    function unloadAllDatasets() {
      loadedDatasetIds.value = [];
      allDomains.value = [];
      checkedDomains.value = [];
      Object.assign(counts, { users: 0, groups: 0, computers: 0, domains: 0 });
    }

    async function deleteDataset(id) {
      await api(`/datasets/${id}`, { method: 'DELETE' });
      datasets.value = datasets.value.filter(d => d.id !== id);
      if (loadedDatasetIds.value.includes(id)) {
        loadedDatasetIds.value = loadedDatasetIds.value.filter(i => i !== id);
        refreshAllDomains();
        if (loadedDatasetIds.value.length) loadTab();
      }
    }

    async function saveNote(dsId, note) {
      await api(`/datasets/${dsId}/note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
      });
      const ds = datasets.value.find(d => d.id === dsId);
      if (ds) ds.note = note;
    }

    function goHome() {
      loadedDatasetIds.value = [];
      allDomains.value = [];
      checkedDomains.value = [];
      Object.assign(counts, { users: 0, groups: 0, computers: 0, domains: 0 });
      currentTab.value = 'dashboard';
      Object.keys(savedTabs).forEach(k => delete savedTabs[k]);
      loadDatasets();
    }

    /* ---- sort / search / filter ---- */
    function sortClass(key) {
      if (td.value.sortKey !== key) return '';
      return td.value.sortOrder === 'asc' ? 'sort-asc' : 'sort-desc';
    }

    function toggleSort(key) {
      // ignore sort when dropping a column
      if (dragFromIdx.value >= 0) return;
      const s = td.value;
      if (s.sortKey === key) { s.sortOrder = s.sortOrder === 'asc' ? 'desc' : 'asc'; }
      else { s.sortKey = key; s.sortOrder = 'asc'; }
      s.page = 1;
      fetchData();
    }

    const _debouncedFetch = debounce(() => { td.value.page = 1; fetchData(); }, 300);
    function onSearch(val) { td.value.search = val; _debouncedFetch(); }
    function onColumnFilter(key, val) {
      td.value.columnFilters[key] = val;
      _debouncedFetch();
    }
    function clearColumnFilter(key) {
      delete td.value.columnFilters[key];
      td.value.page = 1;
      fetchData();
    }

    /* ---- column drag ---- */
    function onColDragStart(idx, e) {
      dragFromIdx.value = idx;
      e.dataTransfer.effectAllowed = 'move';
    }
    function onColDragOver(key) { dragOverCol.value = key; }
    function onColDragLeave(key) { if (dragOverCol.value === key) dragOverCol.value = ''; }
    function onColDrop(toIdx) {
      const fromIdx = dragFromIdx.value;
      if (fromIdx >= 0 && fromIdx !== toIdx) {
        const cols = td.value.columns;
        const vis = cols.filter(c => !td.value.hiddenKeys.has(c.key));
        const fromCol = vis[fromIdx];
        const toCol = vis[toIdx];
        const realFrom = cols.indexOf(fromCol);
        const realTo = cols.indexOf(toCol);
        if (realFrom >= 0 && realTo >= 0) {
          cols.splice(realFrom, 1);
          const insertAt = cols.indexOf(toCol);
          cols.splice(insertAt >= 0 ? (realFrom < realTo ? insertAt + 1 : insertAt) : realTo, 0, fromCol);
        }
      }
      dragFromIdx.value = -1;
      dragOverCol.value = '';
    }
    function onColDragEnd() { dragFromIdx.value = -1; dragOverCol.value = ''; }

    /* ---- filter popover ---- */
    function hasActiveFilter(key) {
      const f = td.value.columnFilters[key];
      return f && (Array.isArray(f) ? f.length > 0 : !!f);
    }

    async function openPopover(colKey, e) {
      e.stopPropagation(); // don't trigger sort
      if (popoverCol.value === colKey) { closePopover(); return; }
      popoverAnchorEl.value = e.currentTarget;
      popoverCol.value = colKey;
      popoverSearch.value = '';
      popoverLoading.value = true;
      await nextTick();
      updatePopoverPosition();
      // build params for distinct API
      const params = new URLSearchParams({
        column: colKey,
        search: td.value.search,
        domains: domainParam(),
      });
      const cf = {};
      for (const [k, v] of Object.entries(td.value.columnFilters)) {
        if (v && (Array.isArray(v) ? v.length : true)) cf[k] = v;
      }
      if (Object.keys(cf).length) params.set('filters', JSON.stringify(cf));
      try {
        const r = await api(`/datasets/${mergedId.value}/data/${currentTab.value}/distinct?${params}`);
        popoverValues.value = r.values;
        popoverCounts.value = r.counts || {};
      } catch { popoverValues.value = []; popoverCounts.value = {}; }
      // init checked from current filter
      const cur = td.value.columnFilters[colKey];
      if (Array.isArray(cur)) {
        popoverChecked.value = new Set(cur);
      } else {
        // all checked by default (no filter)
        popoverChecked.value = new Set(popoverValues.value);
      }
      popoverLoading.value = false;
      await nextTick();
      updatePopoverPosition();
    }

    function togglePopoverItem(val) {
      const s = popoverChecked.value;
      if (s.has(val)) s.delete(val); else s.add(val);
      // force reactivity
      popoverChecked.value = new Set(s);
    }

    function popoverSelectAll() {
      const all = new Set(popoverFiltered.value);
      popoverFiltered.value.forEach(v => all.add(v));
      // also keep already checked items not in filtered
      popoverChecked.value.forEach(v => all.add(v));
      popoverChecked.value = all;
    }

    function popoverDeselectAll() {
      const keep = new Set(popoverChecked.value);
      popoverFiltered.value.forEach(v => keep.delete(v));
      popoverChecked.value = keep;
    }

    function applyPopover() {
      const colKey = popoverCol.value;
      const checked = popoverChecked.value;
      if (checked.size === popoverValues.value.length || checked.size === 0) {
        // all selected or none = no filter
        delete td.value.columnFilters[colKey];
      } else {
        td.value.columnFilters[colKey] = [...checked];
      }
      closePopover();
      td.value.page = 1;
      fetchData();
    }

    function closePopover() {
      popoverCol.value = '';
      popoverAnchorEl.value = null;
    }

    function cancelPopover() { closePopover(); }

    function resetPopoverFilter(colKey, e) {
      e.stopPropagation();
      delete td.value.columnFilters[colKey];
      closePopover();
      td.value.page = 1;
      fetchData();
    }

    // close popover on outside click
    if (typeof document !== 'undefined') {
      document.addEventListener('click', (e) => {
        if (popoverCol.value && !e.target.closest('.filter-popover-wrap')) {
          closePopover();
        }
        if (showDomainDropdown.value && !e.target.closest('.domain-dropdown-wrap')) {
          showDomainDropdown.value = false;
        }
        if (showDatasetSelector.value && !e.target.closest('.dataset-selector-wrap')) {
          showDatasetSelector.value = false;
        }
        if (ctxMenu.visible && !e.target.closest('.ctx-menu')) {
          ctxMenu.visible = false;
        }
      });
    }

    function handleWindowResize() {
      updateTableViewportWidth();
      if (popoverCol.value) updatePopoverPosition();
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleWindowResize);
    }

    watch(
      () => visCols.value.map((col) => col.key).join('|'),
      () => {
        nextTick(() => {
          updateTableViewportWidth();
        });
      }
    );

    onBeforeUnmount(() => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleWindowResize);
      }
    });

    function onDomainChange() { loadTab(); }
    function setAllDomains(checked) {
      checkedDomains.value = checked ? [...allDomains.value] : [];
      loadTab();
    }

    function gotoPage(p) {
      td.value.page = p;
      fetchData();
    }

    /* ---- column manager ---- */
    function isColVisible(col) { return !td.value.hiddenKeys.has(col.key); }
    function toggleCol(col) {
      const h = td.value.hiddenKeys;
      if (h.has(col.key)) h.delete(col.key); else h.add(col.key);
      nextTick(() => {
        updateTableViewportWidth();
      });
    }

    function isTimestampDisplayValue(value) {
      const text = String(value ?? '').trim();
      if (!text) return false;
      return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
        || /^\d{2,4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(text);
    }

    function formatTimestampDisplay(value) {
      const text = String(value ?? '').trim();
      if (!text) return '';

      let match = text.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/);
      if (match) {
        const [, year, month, day, time] = match;
        const displayYear = Number(year) >= 2000 ? year.slice(-2) : year;
        return `${displayYear}/${month}/${day}\n${time}`;
      }

      match = text.match(/^(\d{2,4})\/(\d{2})\/(\d{2}) (\d{2}:\d{2}:\d{2})$/);
      if (match) {
        const [, year, month, day, time] = match;
        const normalizedYear = year.length === 4 && Number(year) >= 2000 ? year.slice(-2) : year;
        return `${normalizedYear}/${month}/${day}\n${time}`;
      }

      return text;
    }

    /* ---- flags ---- */
    function renderFlags(v) {
      if (!v) return '';
      const s = String(v);
      return s.split(',').map(f => {
        const t = f.trim();
        if (/ACCOUNT_DISABLED/i.test(t)) return `<span class="flag-disabled">${t}</span>`;
        return t;
      }).join(', ');
    }

    let textMeasureContext = null;

    function getTextMeasureContext() {
      if (typeof document === 'undefined') {
        return null;
      }
      if (!textMeasureContext) {
        const canvas = document.createElement('canvas');
        textMeasureContext = canvas.getContext('2d');
        if (textMeasureContext) {
          textMeasureContext.font = '13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        }
      }
      return textMeasureContext;
    }

    function measureDisplayTextWidth(text) {
      const value = String(text ?? '');
      const lines = value.split('\n');
      const context = getTextMeasureContext();
      if (!context) {
        return lines.reduce((max, line) => Math.max(max, line.length * 7.2), 0);
      }
      return lines.reduce((max, line) => Math.max(max, context.measureText(line).width), 0);
    }

    function findColumn(columnKey) {
      return (td.value.columns || []).find((column) => column.key === columnKey)
        || (visCols.value || []).find((column) => column.key === columnKey)
        || { key: columnKey, title: columnKey };
    }

    function columnDisplayText(row, column) {
      const key = String(column?.key || '').toLowerCase();
      if (key === 'name') return String(row?.name ?? '').trim();
      if (key === 'sid') return String(row?.sid ?? '').trim();
      if (key === 'flag') {
        return String(row?.[key] ?? '').split(',').map((part) => part.trim()).filter(Boolean).join(', ');
      }
      const raw = row?.[key];
      if (isTimestampDisplayValue(raw)) return formatTimestampDisplay(raw);
      return String(raw ?? '').trim();
    }

    function inferMinimumColumnWidth(column) {
      const key = String(column?.key || '').toLowerCase();
      const title = String(column?.title || '').trim();
      const headerWidth = Math.ceil(measureDisplayTextWidth(title) + 72);

      let minWidth = headerWidth;
      if (key === 'name') minWidth = Math.max(minWidth, 140);
      else if (key === 'samaccountname') minWidth = Math.max(minWidth, 110);
      else if (key === 'displayname') minWidth = Math.max(minWidth, 110);
      else if (key === 'domain' || key === 'netbios') minWidth = Math.max(minWidth, 96);
      else if (key === 'scope') minWidth = Math.max(minWidth, 84);
      else if (key === 'member_count') minWidth = Math.max(minWidth, 88);
      else if (key === 'isdc' || key === 'haslaps' || key === 'lockedout' || key === 'trustedtoauth' || key === 'isreadonlydc') minWidth = Math.max(minWidth, 72);
      else if (key.endsWith('count') || key.endsWith('quota') || key.endsWith('length') || key.endsWith('level') || key.endsWith('threshold')) minWidth = Math.max(minWidth, 88);
      else if (key === 'operatingsystem') minWidth = Math.max(minWidth, 140);
      else if (key === 'flag') minWidth = Math.max(minWidth, 120);
      else if (key === 'description') minWidth = Math.max(minWidth, 160);
      else if (key === 'distinguishedname') minWidth = Math.max(minWidth, 220);
      else if (key === 'serviceprincipalnames') minWidth = Math.max(minWidth, 260);
      else if (key === 'sid') minWidth = Math.max(minWidth, 76);
      else if (key === 'objectguid' || key === 'domainsid' || key === 'primary_group_sid' || key.endsWith('sid')) minWidth = Math.max(minWidth, 180);
      else minWidth = Math.max(minWidth, 88);

      return minWidth;
    }

    function inferAutoPreferredColumnWidth(column, rows) {
      const key = String(column?.key || '').toLowerCase();
      const defaultWidth = parsePixelWidth(inferDefaultColumnWidth(column), 180);
      const minWidth = inferMinimumColumnWidth(column);
      const autoMaxWidth = parsePixelWidth(inferMaxColumnWidth(column), defaultWidth);
      if (!Array.isArray(rows) || !rows.length) {
        return Math.min(autoMaxWidth, Math.max(minWidth, defaultWidth));
      }

      let preferred = minWidth;
      const sampleRows = rows.slice(0, 80);
      for (const row of sampleRows) {
        const text = columnDisplayText(row, column);
        if (!text) continue;

        let extraWidth = 24;
        if (key === 'name') extraWidth += 34;
        else if (key === 'flag') extraWidth += 12;
        else if (isTimestampDisplayValue(row?.[key])) extraWidth += 12;

        preferred = Math.max(preferred, Math.ceil(measureDisplayTextWidth(text) + extraWidth));
      }

      return Math.min(autoMaxWidth, Math.max(minWidth, preferred));
    }

    /* ---- context menu ---- */
    function showContextMenu(e, oid, meta) {
      ctxMenu.objectId = oid;
      ctxMenu.meta = meta && typeof meta === 'object' ? {
        name: meta.name,
        type: meta.type,
        domain: meta.domain,
        description: meta.description,
      } : null;
      ctxMenu.x = e.clientX;
      ctxMenu.y = e.clientY;
      ctxMenu.visible = true;
    }
    function ctxOpenDetail() {
      const oid = ctxMenu.objectId;
      ctxMenu.visible = false;
      if (oid) openDetail(oid);
    }
    function ctxToggleFavorite() {
      const oid = ctxMenu.objectId;
      const meta = ctxMenu.meta || {};
      ctxMenu.visible = false;
      if (!oid) return;
      toggleFavorite({
        object_id: oid,
        name: meta.name,
        type: meta.type,
        domain: meta.domain,
        description: meta.description,
      });
    }
    const ctxIsFavorite = computed(() => isFavorite(ctxMenu.objectId));

    /* ---- detail ---- */
    async function openDetail(oid) {
      // Avoid global loading overlay flash when navigating within an already-open detail panel
      const alreadyOpen = detailVisible.value;
      if (!alreadyOpen) loading.value = true;
      try {
        const obj = await api(`/datasets/${mergedId.value}/object/${encodeURIComponent(oid)}`);
        detailStack.value.push(obj);
        currentDetail.value = obj;
        activeRelKey.value = '';
        const tabs = Object.entries(obj.relations || {}).filter(([, v]) => v && v.length);
        if (tabs.length) activeRelKey.value = tabs[0][0];
        detailVisible.value = true;
        document.body.style.overflow = 'hidden';
      } finally {
        if (!alreadyOpen) loading.value = false;
      }
    }

    function detailBack() {
      if (detailStack.value.length > 1) {
        detailStack.value.pop();
        currentDetail.value = detailStack.value[detailStack.value.length - 1];
        activeRelKey.value = '';
        const tabs = Object.entries(currentDetail.value.relations || {}).filter(([, v]) => v && v.length);
        if (tabs.length) activeRelKey.value = tabs[0][0];
      }
    }

    function closeDetail() {
      detailVisible.value = false;
      detailStack.value = [];
      currentDetail.value = null;
      activeRelKey.value = '';
      document.body.style.overflow = '';
    }

    function inferDefaultColumnWidth(column) {
      const explicitWidth = String(column?.width || '').trim();
      if (explicitWidth) return explicitWidth;

      const key = String(column?.key || '').toLowerCase();
      const title = String(column?.title || '').trim();

      if (key === 'name') return '180px';
      if (key === 'samaccountname') return '120px';
      if (key === 'displayname') return '120px';
      if (key === 'domain' || key === 'netbios') return '108px';
      if (key === 'scope') return '84px';
      if (key === 'member_count') return '88px';
      if (key === 'isdc' || key === 'haslaps' || key === 'lockedout' || key === 'trustedtoauth' || key === 'isreadonlydc') return '72px';
      if (key.endsWith('count') || key.endsWith('quota') || key.endsWith('length') || key.endsWith('level') || key.endsWith('threshold')) return '88px';
      if (key === 'operatingsystem') return '160px';
      if (key === 'flag') return '180px';
      if (key === 'description') return '320px';
      if (key === 'distinguishedname') return '300px';
      if (key === 'serviceprincipalnames') return '360px';
      if (key === 'objectguid' || key === 'domainsid' || key === 'primary_group_sid' || key.endsWith('sid')) return '220px';
      if (title.length <= 4) return '88px';
      if (title.length <= 8) return '112px';
      if (title.length <= 14) return '150px';
      return '180px';
    }

    function inferMaxColumnWidth(column, { manual = false } = {}) {
      const baseWidth = parsePixelWidth(inferDefaultColumnWidth(column), 180);
      const key = String(column?.key || '').toLowerCase();
      const title = String(column?.title || '').trim();

      let maxWidth = 0;
      if (key === 'name') maxWidth = manual ? 560 : 380;
      else if (key === 'samaccountname') maxWidth = manual ? 360 : 260;
      else if (key === 'displayname') maxWidth = manual ? 420 : 300;
      else if (key === 'domain' || key === 'netbios') maxWidth = manual ? 300 : 220;
      else if (key === 'scope') maxWidth = manual ? 180 : 128;
      else if (key === 'member_count') maxWidth = manual ? 180 : 128;
      else if (key === 'isdc' || key === 'haslaps' || key === 'lockedout' || key === 'trustedtoauth' || key === 'isreadonlydc') maxWidth = manual ? 140 : 100;
      else if (key.endsWith('count') || key.endsWith('quota') || key.endsWith('length') || key.endsWith('level') || key.endsWith('threshold')) maxWidth = manual ? 180 : 128;
      else if (key === 'operatingsystem') maxWidth = manual ? 460 : 320;
      else if (key === 'flag') maxWidth = manual ? 620 : 380;
      else if (key === 'description') maxWidth = manual ? 980 : 680;
      else if (key === 'distinguishedname') maxWidth = manual ? 1100 : 760;
      else if (key === 'serviceprincipalnames') maxWidth = manual ? 1400 : 920;
      else if (key === 'objectguid' || key === 'domainsid' || key === 'primary_group_sid' || key.endsWith('sid')) maxWidth = manual ? 620 : 420;
      else if (title.length <= 4) maxWidth = manual ? 220 : 140;
      else if (title.length <= 8) maxWidth = manual ? 320 : 220;
      else if (title.length <= 14) maxWidth = manual ? 460 : 320;
      else maxWidth = manual ? 620 : 380;

      return toPixelWidth(Math.max(baseWidth, maxWidth));
    }

    const contentAwareColWidths = computed(() => {
      const rows = Array.isArray(td.value.rows) ? td.value.rows : [];
      return Object.fromEntries((visCols.value || []).map((column) => [
        column.key,
        inferAutoPreferredColumnWidth(column, rows),
      ]));
    });

    const effectiveColumnLayout = computed(() => {
      const columns = visCols.value || [];
      const layout = columns.map((column) => {
        const defaultWidth = parsePixelWidth(inferDefaultColumnWidth(column), 180);
        const minWidth = inferMinimumColumnWidth(column);
        const autoWidth = Math.max(minWidth, contentAwareColWidths.value[column.key] ?? defaultWidth);
        const autoMaxWidth = Math.max(minWidth, parsePixelWidth(inferMaxColumnWidth(column), defaultWidth));
        const manualMaxWidth = Math.max(autoMaxWidth, parsePixelWidth(inferMaxColumnWidth(column, { manual: true }), autoMaxWidth));
        const explicitWidth = parsePixelWidth(colWidths[column.key], defaultWidth);
        const isUserSized = Boolean(userSizedCols[column.key]);
        const baseWidth = isUserSized
          ? Math.min(manualMaxWidth, Math.max(minWidth, explicitWidth))
          : Math.min(autoMaxWidth, Math.max(minWidth, autoWidth));
        return {
          key: column.key,
          width: baseWidth,
          maxWidth: isUserSized ? baseWidth : Math.max(baseWidth, autoMaxWidth),
        };
      });

      const viewportWidth = tableViewportWidth.value;
      let totalWidth = layout.reduce((sum, column) => sum + column.width, 0);

      if (viewportWidth > totalWidth) {
        let remaining = viewportWidth - totalWidth;
        let growable = layout.filter((column) => column.maxWidth - column.width > 0.5);

        while (remaining > 0.5 && growable.length) {
          const totalCapacity = growable.reduce((sum, column) => sum + (column.maxWidth - column.width), 0);
          let used = 0;

          for (const column of growable) {
            const capacity = column.maxWidth - column.width;
            const share = totalCapacity > 0 ? remaining * (capacity / totalCapacity) : remaining / growable.length;
            const delta = Math.min(share, capacity);
            if (delta > 0) {
              column.width += delta;
              used += delta;
            }
          }

          if (used <= 0.5) {
            break;
          }

          remaining -= used;
          growable = layout.filter((column) => column.maxWidth - column.width > 0.5);
        }

        totalWidth = layout.reduce((sum, column) => sum + column.width, 0);
      }

      return {
        widths: Object.fromEntries(layout.map((column) => [column.key, toPixelWidth(column.width)])),
        tableWidth: totalWidth > 0 ? toPixelWidth(totalWidth) : '',
      };
    });

    const effectiveColWidths = computed(() => effectiveColumnLayout.value.widths);
    const effectiveColStyles = computed(() => Object.fromEntries(
      Object.entries(effectiveColWidths.value).map(([key, width]) => [
        key,
        { width, minWidth: width, maxWidth: width },
      ])
    ));
    const tableStyle = computed(() => {
      const width = effectiveColumnLayout.value.tableWidth;
      return width ? { width } : {};
    });

    /* ---- init ---- */
    onMounted(async () => {
      loadFavorites();
      loadFavColWidths();
      await loadDatasets();
      // auto-load all datasets
      if (datasets.value.length) {
        loadedDatasetIds.value = datasets.value.map(d => d.id);
        refreshAllDomains();
        await loadTab();
      }
      await nextTick();
      updateTableViewportWidth();
    });

    return {
      loading, loadingVisible, uploading, dragging,
      loadedDatasetIds, hasData, datasetName, datasets,
      allDomains, checkedDomains, counts, showDomainDropdown,
      showDatasetSelector, showUploadModal,
      currentTab, tabs, isTableTab,
      td, visCols, dashCards, tableWrapEl, tableStyle, effectiveColWidths, effectiveColStyles,
      showColManager, groupedData,
      detailVisible, detailStack, currentDetail, activeRelKey, activeRelTabs,
      pageRange,
      // methods
      switchTab, onFileSelect, onDrop,
      toggleDataset, loadAllDatasets, unloadAllDatasets,
      deleteDataset, saveNote, goHome,
      fetchData,
      sortClass, toggleSort,
      onSearch, onColumnFilter, clearColumnFilter,
      onDomainChange, setAllDomains,
      gotoPage, doUpload,
      isColVisible, toggleCol,
      isTimestampDisplayValue, formatTimestampDisplay,
      renderFlags, openDetail, detailBack, closeDetail,
      ctxMenu, showContextMenu, ctxOpenDetail, ctxToggleFavorite, ctxIsFavorite,
      favorites, isFavorite, removeFavorite, formatFavoriteTime, updateFavoriteNote,
      favColWidths, favColStyle, onFavResizeStart,
      // drag
      dragOverCol, onColDragStart, onColDragOver, onColDragLeave, onColDrop, onColDragEnd,
      colWidths, onResizeStart,
      // popover filter
      popoverCol, popoverValues, popoverCounts, popoverChecked, popoverSearch, popoverLoading,
      popoverFiltered, popoverAllChecked, popoverPos, popoverEl,
      hasActiveFilter, openPopover, togglePopoverItem,
      popoverSelectAll, popoverDeselectAll, applyPopover, cancelPopover, resetPopoverFilter,
    };
  },
});

app.component('object-label', ObjectLabel);

// Auto-grow directive: makes textarea height follow content
app.directive('autoheight', {
  mounted(el) {
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    el.__autofit = fit;
    el.addEventListener('input', fit);
    requestAnimationFrame(fit);
  },
  updated(el) {
    if (el.__autofit) requestAnimationFrame(el.__autofit);
  },
  unmounted(el) {
    if (el.__autofit) {
      el.removeEventListener('input', el.__autofit);
      el.__autofit = null;
    }
  },
});

app.mount('#app');
