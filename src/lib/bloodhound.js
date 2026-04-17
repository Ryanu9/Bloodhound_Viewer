const UAC_FLAGS = [
  ['ACCOUNT_DISABLED', 0x00000002],
  ['ACCOUNT_LOCKED', 0x00000010],
  ['PASSWD_NOTREQD', 0x00000020],
  ['PASSWD_CANT_CHANGE', 0x00000040],
  ['PASSWORD_STORE_CLEARTEXT', 0x00000080],
  ['NORMAL_ACCOUNT', 0x00000200],
  ['WORKSTATION_ACCOUNT', 0x00001000],
  ['SERVER_TRUST_ACCOUNT', 0x00002000],
  ['DONT_EXPIRE_PASSWD', 0x00010000],
  ['SMARTCARD_REQUIRED', 0x00040000],
  ['TRUSTED_FOR_DELEGATION', 0x00080000],
  ['NOT_DELEGATED', 0x00100000],
  ['USE_DES_KEY_ONLY', 0x00200000],
  ['DONT_REQ_PREAUTH', 0x00400000],
  ['PASSWORD_EXPIRED', 0x00800000],
  ['TRUSTED_TO_AUTH_FOR_DELEGATION', 0x01000000],
  ['PARTIAL_SECRETS_ACCOUNT', 0x04000000],
];

const PWD_FLAGS = [
  ['PASSWORD_COMPLEX', 0x01],
  ['PASSWORD_NO_ANON_CHANGE', 0x02],
  ['PASSWORD_NO_CLEAR_CHANGE', 0x04],
  ['LOCKOUT_ADMINS', 0x08],
  ['PASSWORD_STORE_CLEARTEXT', 0x10],
  ['REFUSE_PASSWORD_CHANGE', 0x20],
];

const TRUST_FLAGS = [
  ['NON_TRANSITIVE', 0x00000001],
  ['UPLEVEL_ONLY', 0x00000002],
  ['QUARANTINED_DOMAIN', 0x00000004],
  ['FOREST_TRANSITIVE', 0x00000008],
  ['CROSS_ORGANIZATION', 0x00000010],
  ['WITHIN_FOREST', 0x00000020],
  ['TREAT_AS_EXTERNAL', 0x00000040],
  ['USES_RC4_ENCRYPTION', 0x00000080],
  ['CROSS_ORGANIZATION_NO_TGT_DELEGATION', 0x00000200],
  ['PIM_TRUST', 0x00000400],
  ['CROSS_ORGANIZATION_ENABLE_TGT_DELEGATION', 0x00000800],
];

const TRUST_DIRECTIONS = {
  0x01: 'INBOUND',
  0x02: 'OUTBOUND',
  0x03: 'BIDIRECTIONAL',
};

const TRUST_TYPES = {
  0x01: 'DOWNLEVEL',
  0x02: 'UPLEVEL',
  0x03: 'MIT',
};

function stripBom(text) {
  return String(text ?? '').replace(/^\uFEFF/, '');
}

function stableStringify(value) {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function compareTextInsensitive(left, right) {
  const a = String(left ?? '').toLowerCase();
  const b = String(right ?? '').toLowerCase();

  if (a < b) {
    return -1;
  }

  if (a > b) {
    return 1;
  }

  return 0;
}

function sortByName(rows) {
  return [...rows].sort((left, right) => compareTextInsensitive(left.name, right.name));
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateUtcPlus8(date) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())} ${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}`;
}

function objectEntriesFromValue(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
}

function normalizeDatasetKey(value) {
  const lower = String(value || '').trim().toLowerCase();
  if (lower === 'user' || lower === 'users') {
    return 'users';
  }
  if (lower === 'group' || lower === 'groups') {
    return 'groups';
  }
  if (lower === 'computer' || lower === 'computers') {
    return 'computers';
  }
  if (lower === 'domain' || lower === 'domains') {
    return 'domains';
  }
  return null;
}

function hasOwn(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function hasAnyOwn(object, keys) {
  return (keys || []).some((key) => hasOwn(object, key));
}

function detectDatasetKeyFromEntries(entries) {
  const scores = {
    users: 0,
    groups: 0,
    computers: 0,
    domains: 0,
  };

  for (const item of (entries || []).slice(0, 25)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const props = item.Properties && typeof item.Properties === 'object' && !Array.isArray(item.Properties)
      ? item.Properties
      : {};

    if (
      hasAnyOwn(item, ['Trusts', 'Links', 'ChildObjects', 'GPOChanges'])
      || hasAnyOwn(props, ['domainsid', 'functionallevel', 'machineaccountquota', 'minpwdlength', 'pwdhistorylength'])
    ) {
      scores.domains += 4;
    }

    if (Array.isArray(item.Members) || hasAnyOwn(props, ['groupscope'])) {
      scores.groups += 4;
    }

    if (
      hasAnyOwn(item, ['Sessions', 'PrivilegedSessions', 'RegistrySessions', 'NtlmSessions', 'LocalAdmins', 'RemoteDesktopUsers', 'DcomUsers', 'PSRemoteUsers'])
      || hasAnyOwn(props, ['operatingsystem', 'haslaps', 'isdc', 'isreadonlydc', 'trustedtoauth'])
    ) {
      scores.computers += 4;
    }

    if (
      hasAnyOwn(item, ['SPNTargets'])
      || hasAnyOwn(props, ['displayname', 'email', 'title', 'hasspn', 'dontreqpreauth', 'smartcardrequired', 'passwordexpired', 'pwdneverexpires', 'sensitive'])
    ) {
      scores.users += 4;
    }

    const samAccountName = String(props.samaccountname || '');
    if (samAccountName) {
      if (samAccountName.endsWith('$')) {
        scores.computers += 2;
      } else {
        scores.users += 1;
        scores.groups += 1;
      }
    }

    if (hasOwn(item, 'PrimaryGroupSID')) {
      if (samAccountName.endsWith('$') || hasOwn(props, 'operatingsystem')) {
        scores.computers += 2;
      } else {
        scores.users += 2;
      }
    }
  }

  const ranked = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1]);

  if (!ranked.length) {
    return null;
  }

  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    return null;
  }

  return ranked[0][0];
}

function loadBloodHoundCollectionFromText(text) {
  const payload = JSON.parse(stripBom(text));
  const entries = Array.isArray(payload)
    ? objectEntriesFromValue(payload)
    : payload && typeof payload === 'object'
      ? objectEntriesFromValue(payload.data)
      : [];
  const metaType = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? normalizeDatasetKey((payload.meta && payload.meta.type) || payload.type)
    : null;

  return {
    key: metaType || detectDatasetKeyFromEntries(entries),
    entries,
  };
}

function loadJsonEntriesFromText(text) {
  return loadBloodHoundCollectionFromText(text).entries;
}

function displayValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (Array.isArray(value)) {
    return value.map((item) => displayValue(item)).filter(Boolean).join(', ');
  }

  if (typeof value === 'object') {
    const objectId = value.ObjectIdentifier || value.PrincipalSID || value.GUID;
    if (objectId) {
      return String(objectId);
    }
    return stableStringify(value);
  }

  const text = String(value);
  return text === 'None' ? '' : text;
}

function normalizeSid(value) {
  const text = String(value || '').trim();
  return /^S-\d(?:-\d+)+$/i.test(text) ? text : '';
}

function ridFromSid(value) {
  const sid = normalizeSid(value);
  if (!sid) {
    return '';
  }
  const parts = sid.split('-');
  return parts[parts.length - 1] || '';
}

function parseInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (/^[-+]?0x[0-9a-f]+$/i.test(text)) {
    const parsedHex = Number.parseInt(text, 16);
    return Number.isNaN(parsedHex) ? null : parsedHex;
  }

  if (/^[-+]?\d+$/.test(text)) {
    const parsedInt = Number.parseInt(text, 10);
    return Number.isNaN(parsedInt) ? null : parsedInt;
  }

  const parsedFloat = Number.parseFloat(text);
  return Number.isNaN(parsedFloat) ? null : Math.trunc(parsedFloat);
}

function parseBoolean(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  const text = String(value).trim().toLowerCase();
  if (text === 'true' || text === 'yes' || text === '1') {
    return true;
  }
  if (text === 'false' || text === 'no' || text === '0') {
    return false;
  }
  return null;
}

function parseBigInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
    return BigInt(value);
  }

  const text = String(value).trim();
  if (!text || !/^[-+]?\d+$/.test(text)) {
    return null;
  }

  return BigInt(text);
}

function decodeBitFlags(value, definitions) {
  const number = parseInteger(value);
  if (number === null) {
    return [];
  }
  return definitions.filter(([, bit]) => (number & bit) === bit).map(([name]) => name);
}

function decodeNamedValue(value, definitions) {
  const number = parseInteger(value);
  if (number === null) {
    return '';
  }
  return definitions[number] || String(number);
}

function appendFlagFromBool(flagNames, name, value, invert = false) {
  const boolean = parseBoolean(value);
  if (boolean === null) {
    return;
  }
  const result = invert ? !boolean : boolean;
  if (result) {
    flagNames.push(name);
  }
}

function joinFlagNames(flagNames) {
  return [...new Set(flagNames.filter(Boolean))].join(', ');
}

function buildUacFlagText(item, props) {
  const flagNames = decodeBitFlags(props.useraccountcontrol, UAC_FLAGS);
  appendFlagFromBool(flagNames, 'ACCOUNT_DISABLED', props.enabled, true);
  appendFlagFromBool(flagNames, 'ACCOUNT_LOCKED', props.lockedout);
  appendFlagFromBool(flagNames, 'PASSWD_NOTREQD', props.passwordnotreqd);
  appendFlagFromBool(flagNames, 'PASSWD_CANT_CHANGE', props.cantchangepassword);
  appendFlagFromBool(flagNames, 'PASSWORD_STORE_CLEARTEXT', props.encryptedtextpwdallowed);
  appendFlagFromBool(flagNames, 'DONT_EXPIRE_PASSWD', props.pwdneverexpires);
  appendFlagFromBool(flagNames, 'SMARTCARD_REQUIRED', props.smartcardrequired);
  appendFlagFromBool(flagNames, 'TRUSTED_FOR_DELEGATION', props.unconstraineddelegation ?? item.UnconstrainedDelegation);
  appendFlagFromBool(flagNames, 'NOT_DELEGATED', props.sensitive);
  appendFlagFromBool(flagNames, 'USE_DES_KEY_ONLY', props.usedeskeyonly);
  appendFlagFromBool(flagNames, 'DONT_REQ_PREAUTH', props.dontreqpreauth);
  appendFlagFromBool(flagNames, 'PASSWORD_EXPIRED', props.passwordexpired);
  appendFlagFromBool(flagNames, 'TRUSTED_TO_AUTH_FOR_DELEGATION', props.trustedtoauth);
  appendFlagFromBool(flagNames, 'PARTIAL_SECRETS_ACCOUNT', props.isreadonlydc);
  return joinFlagNames(flagNames);
}

function buildTrustFlagSummary(trust) {
  const direction = decodeNamedValue(trust.TrustDirection ?? trust.trustdirection, TRUST_DIRECTIONS);
  const trustType = decodeNamedValue(trust.TrustType ?? trust.trusttype, TRUST_TYPES);
  const attributes = decodeBitFlags(trust.TrustAttributes ?? trust.trustattributes, TRUST_FLAGS);
  const parts = [direction, trustType, ...attributes].filter(Boolean);

  if (!parts.length) {
    return '';
  }

  const target = String(
    trust.TargetDomainName ||
      trust.TargetDomain ||
      trust.TargetDomainSid ||
      trust.TargetDomainSID ||
      trust.TargetDomainGuid ||
      trust.TargetDomainGUID ||
      ''
  );

  if (target) {
    return `${target}: ${parts.join(' | ')}`;
  }

  return parts.join(' | ');
}

function buildDomainFlagText(item, props) {
  const flagParts = [];
  const passwordFlags = joinFlagNames(decodeBitFlags(props.pwdproperties, PWD_FLAGS));
  if (passwordFlags) {
    flagParts.push(passwordFlags);
  }

  for (const trust of item.Trusts || []) {
    const summary = buildTrustFlagSummary(trust);
    if (summary) {
      flagParts.push(`TRUST[${summary}]`);
    }
  }

  return flagParts.join('; ');
}

function formatTimestamp(value) {
  if (value === null || value === undefined || value === '' || value === 0 || value === '0') {
    return '';
  }

  const bigIntValue = parseBigInteger(value);
  if (bigIntValue === null) {
    return String(value);
  }

  if (bigIntValue <= 0n) {
    return '';
  }

  let date;

  try {
    if (bigIntValue >= 1000000000000000n) {
      const epochMs = bigIntValue / 10000n - 11644473600000n;
      date = new Date(Number(epochMs));
    } else if (bigIntValue >= 1000000000000n) {
      date = new Date(Number(bigIntValue));
    } else {
      date = new Date(Number(bigIntValue) * 1000);
    }
  } catch {
    return String(value);
  }

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return formatDateUtcPlus8(date);
}

function normalizeObjectTypeName(value) {
  const text = String(value || '').trim();
  if (!text) {
    return 'Object';
  }

  const mapping = {
    user: 'User',
    group: 'Group',
    computer: 'Computer',
    domain: 'Domain',
    container: 'Container',
    ou: 'OU',
    organizationalunit: 'OU',
    gpo: 'GPO',
    grouppolicyobject: 'GPO',
    localgroup: 'LocalGroup',
    adlocalgroup: 'LocalGroup',
  };

  return mapping[text.toLowerCase()] || `${text[0].toUpperCase()}${text.slice(1)}`;
}

function anchorId(value) {
  const text = String(value || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return text || 'section';
}

function dedupeObjects(items) {
  const seen = new Set();
  const uniqueItems = [];

  for (const item of items || []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const props = item.Properties || {};
    let identity = normalizeSid(item.ObjectIdentifier || props.objectsid || props.domainsid)
      || item.ObjectIdentifier
      || props.objectguid
      || props.domainsid
      || props.name
      || props.samaccountname;
    if (!identity) {
      identity = stableStringify(item);
    }

    if (seen.has(identity)) {
      continue;
    }

    seen.add(identity);
    uniqueItems.push(item);
  }

  return uniqueItems;
}

function normalizeUsers(rawUsers) {
  const rows = [];

  for (const item of dedupeObjects(rawUsers)) {
    const props = item.Properties || {};
    const sidFull = normalizeSid(item.ObjectIdentifier || props.objectsid);
    rows.push({
      object_id: item.ObjectIdentifier || '',
      name: props.name || props.samaccountname || item.ObjectIdentifier || '',
      samaccountname: props.samaccountname || '',
      sid: ridFromSid(sidFull),
      sid_full: sidFull,
      displayname: displayValue(props.displayname),
      domain: props.domain || '',
      flag: buildUacFlagText(item, props),
      whencreated: formatTimestamp(props.whencreated),
      lastlogon: formatTimestamp(props.lastlogon),
      pwdlastset: formatTimestamp(props.pwdlastset),
      description: displayValue(props.description),
      email: displayValue(props.email),
      title: displayValue(props.title),
      lockedout: displayValue(props.lockedout),
      passwordexpired: displayValue(props.passwordexpired),
      pwdneverexpires: displayValue(props.pwdneverexpires),
      dontreqpreauth: displayValue(props.dontreqpreauth),
      hasspn: displayValue(props.hasspn),
      sensitive: displayValue(props.sensitive),
      smartcardrequired: displayValue(props.smartcardrequired),
      unconstraineddelegation: displayValue(props.unconstraineddelegation ?? item.UnconstrainedDelegation),
      admincount: displayValue(props.admincount),
      adminsdholderprotected: displayValue(props.adminsdholderprotected),
      isaclprotected: displayValue(props.isaclprotected ?? item.IsACLProtected),
      supportedencryptiontypes: displayValue(props.supportedencryptiontypes),
      lastlogontimestamp: formatTimestamp(props.lastlogontimestamp),
      serviceprincipalnames: displayValue(props.serviceprincipalnames || []),
      primary_group_sid: item.PrimaryGroupSID || '',
      distinguishedname: displayValue(props.distinguishedname),
      objectguid: displayValue(props.objectguid),
      type: 'User',
    });
  }

  return sortByName(rows);
}

function normalizeGroups(rawGroups) {
  const rows = [];

  for (const item of dedupeObjects(rawGroups)) {
    const props = item.Properties || {};
    const sidFull = normalizeSid(item.ObjectIdentifier || props.objectsid);
    rows.push({
      object_id: item.ObjectIdentifier || '',
      name: props.name || props.samaccountname || item.ObjectIdentifier || '',
      samaccountname: props.samaccountname || '',
      sid: ridFromSid(sidFull),
      sid_full: sidFull,
      domain: props.domain || '',
      scope: displayValue(props.groupscope),
      member_count: (item.Members || []).length,
      whencreated: formatTimestamp(props.whencreated),
      description: displayValue(props.description),
      admincount: displayValue(props.admincount),
      adminsdholderprotected: displayValue(props.adminsdholderprotected),
      isaclprotected: displayValue(props.isaclprotected ?? item.IsACLProtected),
      distinguishedname: displayValue(props.distinguishedname),
      objectguid: displayValue(props.objectguid),
      sidhistory: displayValue(props.sidhistory || []),
      members: item.Members || [],
      type: 'Group',
    });
  }

  return sortByName(rows);
}

function normalizeComputers(rawComputers) {
  const rows = [];

  for (const item of dedupeObjects(rawComputers)) {
    const props = item.Properties || {};
    const sidFull = normalizeSid(item.ObjectIdentifier || props.objectsid);
    rows.push({
      object_id: item.ObjectIdentifier || '',
      name: props.name || props.samaccountname || item.ObjectIdentifier || '',
      samaccountname: props.samaccountname || '',
      sid: ridFromSid(sidFull),
      sid_full: sidFull,
      domain: props.domain || '',
      operatingsystem: displayValue(props.operatingsystem) || 'Unknown',
      flag: buildUacFlagText(item, props),
      isdc: displayValue(props.isdc ?? item.IsDC),
      whencreated: formatTimestamp(props.whencreated),
      lastlogon: formatTimestamp(props.lastlogon),
      pwdlastset: formatTimestamp(props.pwdlastset),
      description: displayValue(props.description),
      isreadonlydc: displayValue(props.isreadonlydc),
      haslaps: displayValue(props.haslaps),
      lockedout: displayValue(props.lockedout),
      unconstraineddelegation: displayValue(props.unconstraineddelegation ?? item.UnconstrainedDelegation),
      trustedtoauth: displayValue(props.trustedtoauth),
      admincount: displayValue(props.admincount),
      supportedencryptiontypes: displayValue(props.supportedencryptiontypes),
      lastlogontimestamp: formatTimestamp(props.lastlogontimestamp),
      serviceprincipalnames: displayValue(props.serviceprincipalnames || []),
      primary_group_sid: item.PrimaryGroupSID || '',
      distinguishedname: displayValue(props.distinguishedname),
      objectguid: displayValue(props.objectguid),
      type: 'Computer',
    });
  }

  return sortByName(rows);
}

function normalizeDomains(rawDomains) {
  const rows = [];

  for (const item of dedupeObjects(rawDomains)) {
    const props = item.Properties || {};
    rows.push({
      object_id: item.ObjectIdentifier || '',
      name: props.name || item.ObjectIdentifier || '',
      domain: props.domain || '',
      netbios: displayValue(props.netbios),
      domainsid: displayValue(props.domainsid),
      functionallevel: displayValue(props.functionallevel),
      flag: buildDomainFlagText(item, props),
      minpwdlength: displayValue(props.minpwdlength),
      pwdhistorylength: displayValue(props.pwdhistorylength),
      lockoutthreshold: displayValue(props.lockoutthreshold),
      maxpwdage: displayValue(props.maxpwdage),
      minpwdage: displayValue(props.minpwdage),
      machineaccountquota: displayValue(props.machineaccountquota),
      whencreated: formatTimestamp(props.whencreated),
      distinguishedname: displayValue(props.distinguishedname),
      objectguid: displayValue(props.objectguid),
      pwdproperties: displayValue(props.pwdproperties),
      lockoutduration: displayValue(props.lockoutduration),
      lockoutobservationwindow: displayValue(props.lockoutobservationwindow),
      expirepasswordsonsmartcardonlyaccounts: displayValue(props.expirepasswordsonsmartcardonlyaccounts),
      dsheuristics: displayValue(props.dsheuristics),
      collected: displayValue(props.collected),
      type: 'Domain',
    });
  }

  return sortByName(rows);
}

function relationObjectId(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }

  return String(item.ObjectIdentifier || item.PrincipalSID || item.UserSID || item.ComputerSID || item.GUID || '');
}

function objectNameFromItem(item, objectLookup) {
  if (!item || typeof item !== 'object') {
    return displayValue(item) || '(Unknown)';
  }

  const props = item.Properties || {};
  const objectId = relationObjectId(item);
  let name = props.name || props.samaccountname || item.Name || item.name || item.ComputerName || item.UserName;
  if (!name && objectId && objectLookup[objectId]) {
    name = objectLookup[objectId].name;
  }
  return String(name || objectId || '(Unknown)');
}

function objectTypeFromItem(item, objectLookup) {
  if (!item || typeof item !== 'object') {
    return 'Object';
  }

  const objectId = relationObjectId(item);
  let objectType = item.ObjectType || item.PrincipalType || item.Type || '';
  if (!objectType && objectId && objectLookup[objectId]) {
    objectType = objectLookup[objectId].type;
  }
  return normalizeObjectTypeName(objectType);
}

function buildObjectDetailInfo(row, titlePairs) {
  const info = [
    { label: 'Object Identifier', value: displayValue(row.object_id) },
    { label: 'Node Type', value: displayValue(row.type) },
  ];

  const seenLabels = new Set(['Object Identifier', 'Node Type']);

  for (const [key, title] of titlePairs || []) {
    const value = key === 'sid'
      ? displayValue(row.sid_full || row.sid)
      : displayValue(row[key]);
    if (!value || seenLabels.has(title)) {
      continue;
    }
    seenLabels.add(title);
    info.push({ label: title, value });
  }

  return info;
}

function addRelation(details, objectLookup, seenRelations, sourceId, relationKey, objectId = '', name = '', objectType = '', meta = '') {
  if (!details[sourceId]) {
    return;
  }

  const resolvedId = objectId && details[objectId] ? objectId : '';
  const resolvedName = name || (objectId ? objectLookup[objectId]?.name : '') || objectId || '(Unknown)';
  const resolvedType = normalizeObjectTypeName(objectType || (objectId ? objectLookup[objectId]?.type : '') || 'Object');
  const resolvedMeta = displayValue(meta);
  const signature = stableStringify([resolvedId, resolvedName, resolvedType, resolvedMeta]);
  const bucketKey = `${sourceId}::${relationKey}`;

  if (!seenRelations.has(bucketKey)) {
    seenRelations.set(bucketKey, new Set());
  }

  if (seenRelations.get(bucketKey).has(signature)) {
    return;
  }

  seenRelations.get(bucketKey).add(signature);
  details[sourceId].relations[relationKey].push({
    object_id: resolvedId,
    name: resolvedName,
    type: resolvedType,
    meta: resolvedMeta,
  });
}

function buildObjectDetailData(rawUsers, rawGroups, rawComputers, rawDomains, users, groups, computers, domains, titlePairsByType) {
  const details = {};
  const objectLookup = {};

  for (const rows of [users, groups, computers, domains]) {
    for (const row of rows) {
      const objectId = row.object_id || '';
      if (!objectId) {
        continue;
      }

      const objectType = normalizeObjectTypeName(row.type || 'Object');
      objectLookup[objectId] = {
        object_id: objectId,
        name: row.name || objectId,
        type: objectType,
      };

      details[objectId] = {
        object_id: objectId,
        type: objectType,
        name: row.name || objectId,
        info: buildObjectDetailInfo(row, titlePairsByType[objectType] || []),
        relations: {
          members: [],
          memberOf: [],
          aces: [],
          sessions: [],
          delegation: [],
        },
      };
    }
  }

  const seenRelations = new Map();

  for (const group of dedupeObjects(rawGroups)) {
    const sourceId = group.ObjectIdentifier || '';
    for (const member of group.Members || []) {
      const memberId = relationObjectId(member);
      const memberName = objectNameFromItem(member, objectLookup);
      const memberType = objectTypeFromItem(member, objectLookup);
      addRelation(details, objectLookup, seenRelations, sourceId, 'members', memberId, memberName, memberType, '');
      if (memberId && details[memberId]) {
        addRelation(
          details,
          objectLookup,
          seenRelations,
          memberId,
          'memberOf',
          sourceId,
          objectLookup[sourceId]?.name || sourceId,
          objectLookup[sourceId]?.type || 'Group',
          ''
        );
      }
    }
  }

  for (const row of [...users, ...computers]) {
    const sourceId = row.object_id || '';
    const groupId = row.primary_group_sid || '';
    if (sourceId && groupId && details[groupId]) {
      addRelation(details, objectLookup, seenRelations, sourceId, 'memberOf', groupId, objectLookup[groupId].name, objectLookup[groupId].type, 'Primary Group');
      addRelation(details, objectLookup, seenRelations, groupId, 'members', sourceId, objectLookup[sourceId]?.name || sourceId, objectLookup[sourceId]?.type || 'Object', 'Primary Group');
    }
  }

  for (const rawCollection of [rawUsers, rawGroups, rawComputers, rawDomains]) {
    for (const item of dedupeObjects(rawCollection)) {
      const sourceId = item.ObjectIdentifier || '';
      if (!details[sourceId]) {
        continue;
      }

      for (const ace of item.Aces || []) {
        const principalId = relationObjectId(ace);
        const principalName = objectNameFromItem(ace, objectLookup);
        const principalType = objectTypeFromItem(ace, objectLookup);
        let meta = displayValue(ace.RightName);
        if (ace.IsInherited) {
          meta = meta ? `${meta} (Inherited)` : 'Inherited';
        }
        addRelation(details, objectLookup, seenRelations, sourceId, 'aces', principalId, principalName, principalType, meta);
      }
    }
  }

  const sessionFields = [
    ['Sessions', 'Session'],
    ['PrivilegedSessions', 'Privileged Session'],
    ['RegistrySessions', 'Registry Session'],
    ['NtlmSessions', 'NTLM Session'],
  ];

  for (const computer of dedupeObjects(rawComputers)) {
    const computerId = computer.ObjectIdentifier || '';
    if (!details[computerId]) {
      continue;
    }

    for (const [fieldName, metaLabel] of sessionFields) {
      const container = computer[fieldName];
      const results = Array.isArray(container) ? container : container && typeof container === 'object' ? container.Results || [] : [];
      for (const result of results) {
        const userId = String(result.UserSID || '');
        const relatedComputerId = String(result.ComputerSID || computerId);
        if (userId) {
          addRelation(details, objectLookup, seenRelations, computerId, 'sessions', userId, objectLookup[userId]?.name || userId, objectLookup[userId]?.type || 'User', metaLabel);
        }
        if (userId && details[userId] && details[relatedComputerId]) {
          addRelation(details, objectLookup, seenRelations, userId, 'sessions', relatedComputerId, objectLookup[relatedComputerId].name, objectLookup[relatedComputerId].type, metaLabel);
        }
      }
    }
  }

  const delegationFields = [
    ['AllowedToDelegate', 'Allowed To Delegate'],
    ['AllowedToAct', 'Allowed To Act'],
  ];

  for (const rawCollection of [rawUsers, rawComputers]) {
    for (const item of dedupeObjects(rawCollection)) {
      const sourceId = item.ObjectIdentifier || '';
      if (!details[sourceId]) {
        continue;
      }

      for (const [fieldName, metaLabel] of delegationFields) {
        const container = item[fieldName];
        const results = Array.isArray(container) ? container : container && typeof container === 'object' ? container.Results || [] : [];
        for (const target of results) {
          const targetId = relationObjectId(target);
          const targetName = objectNameFromItem(target, objectLookup);
          const targetType = objectTypeFromItem(target, objectLookup);
          addRelation(details, objectLookup, seenRelations, sourceId, 'delegation', targetId, targetName, targetType, metaLabel);
          if (targetId && details[targetId]) {
            addRelation(details, objectLookup, seenRelations, targetId, 'delegation', sourceId, objectLookup[sourceId].name, objectLookup[sourceId].type, 'Delegated By');
          }
        }
      }
    }
  }

  for (const detail of Object.values(details)) {
    for (const relations of Object.values(detail.relations)) {
      relations.sort((left, right) => {
        const typePriority = Number((left.type || '') !== 'Group') - Number((right.type || '') !== 'Group');
        if (typePriority !== 0) {
          return typePriority;
        }
        const nameOrder = compareTextInsensitive(left.name, right.name);
        if (nameOrder !== 0) {
          return nameOrder;
        }
        return compareTextInsensitive(left.meta, right.meta);
      });
    }
  }

  return { objects: details };
}

function buildUsersByGroup(groups, users) {
  const groupLookup = Object.fromEntries(groups.filter((group) => group.object_id).map((group) => [group.object_id, group]));
  const userLookup = Object.fromEntries(users.filter((user) => user.object_id).map((user) => [user.object_id, user]));
  const grouped = new Map();

  function ensureBucket(groupId) {
    if (!grouped.has(groupId)) {
      grouped.set(groupId, new Map());
    }
    return grouped.get(groupId);
  }

  for (const group of groups) {
    for (const member of group.members || []) {
      const objectId = member.ObjectIdentifier || '';
      const objectType = String(member.ObjectType || '').toLowerCase();
      if (objectType === 'user' && userLookup[objectId]) {
        ensureBucket(group.object_id).set(objectId, { ...userLookup[objectId], type: 'User' });
      } else if (objectType === 'group' && groupLookup[objectId]) {
        const nested = groupLookup[objectId];
        ensureBucket(group.object_id).set(objectId, {
          object_id: nested.object_id,
          name: nested.name,
          samaccountname: nested.samaccountname,
          displayname: '',
          domain: nested.domain,
          flag: '',
          description: nested.description,
          whencreated: nested.whencreated,
          lastlogon: '',
          pwdlastset: '',
          serviceprincipalnames: '',
          primary_group_sid: '',
          type: 'Group',
          target_anchor: anchorId(nested.object_id),
        });
      }
    }
  }

  for (const user of users) {
    const primaryGroupSid = user.primary_group_sid;
    if (primaryGroupSid && groupLookup[primaryGroupSid]) {
      ensureBucket(primaryGroupSid).set(user.object_id, { ...user, type: 'User' });
    }
  }

  const sections = [];
  for (const group of groups) {
    const members = grouped.get(group.object_id);
    if (!members || members.size === 0) {
      continue;
    }
    sections.push([
      group,
      [...members.values()].sort((left, right) => {
        const typePriority = Number((left.type || '') !== 'Group') - Number((right.type || '') !== 'Group');
        if (typePriority !== 0) {
          return typePriority;
        }
        return compareTextInsensitive(left.name, right.name);
      }),
    ]);
  }

  return sections;
}

function buildComputersByOs(computers) {
  const grouped = new Map();

  for (const computer of computers) {
    const osName = computer.operatingsystem || 'Unknown';
    if (!grouped.has(osName)) {
      grouped.set(osName, []);
    }
    grouped.get(osName).push(computer);
  }

  return [...grouped.entries()]
    .map(([name, rows]) => [name, [...rows].sort((left, right) => compareTextInsensitive(left.name, right.name))])
    .sort((left, right) => {
      if (left[0] === 'Unknown' && right[0] !== 'Unknown') {
        return 1;
      }
      if (left[0] !== 'Unknown' && right[0] === 'Unknown') {
        return -1;
      }
      return compareTextInsensitive(left[0], right[0]);
    });
}

module.exports = {
  anchorId,
  buildComputersByOs,
  buildObjectDetailData,
  buildUsersByGroup,
  loadBloodHoundCollectionFromText,
  loadJsonEntriesFromText,
  normalizeComputers,
  normalizeDomains,
  normalizeGroups,
  normalizeSid,
  normalizeUsers,
  ridFromSid,
};
