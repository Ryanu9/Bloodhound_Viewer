function timeColumnFilterTitle(label) {
  return `${label} (UTC+8)`;
}

function timeColumnDef(key, title, filterLabel, defaultVisible = true, width = '128px') {
  return {
    key,
    title,
    filter_title: timeColumnFilterTitle(filterLabel),
    default_visible: defaultVisible,
    width,
  };
}

function normalizeColumnDefs(columns) {
  return columns.map((column) => {
    if (column && typeof column === 'object' && !Array.isArray(column)) {
      return {
        key: String(column.key || ''),
        title: String(column.title || column.key || ''),
        filter_title: String(column.filter_title || column.title || column.key || ''),
        default_visible: Boolean(column.default_visible ?? true),
        width: column.width ? String(column.width) : '',
      };
    }

    const [key, title, defaultVisible = true] = column;
    return {
      key: String(key),
      title: String(title),
      filter_title: String(title),
      default_visible: Boolean(defaultVisible),
      width: '',
    };
  });
}

const USER_COLUMNS = normalizeColumnDefs([
  ['name', 'Name', true],
  ['samaccountname', 'SAM Name', true],
  { key: 'sid', title: 'SID', filter_title: 'SID', default_visible: true, width: '76px' },
  ['displayname', 'DN', true],
  ['domain', 'Domain', true],
  ['flag', 'Flags', true],
  timeColumnDef('whencreated', 'Created on', 'When Created', true, '128px'),
  timeColumnDef('lastlogon', 'Last Logon', 'Last Logon', true, '128px'),
  timeColumnDef('pwdlastset', 'Password Set', 'Password Last Set', true, '132px'),
  ['description', 'Description', true],
  ['email', 'Email', false],
  ['title', 'Title', false],
  ['lockedout', 'Locked Out', false],
  ['passwordexpired', 'Password Expired', false],
  ['pwdneverexpires', 'Password Never Expires', false],
  ['dontreqpreauth', 'No Preauth Required', false],
  ['hasspn', 'Has SPN', false],
  ['sensitive', 'Sensitive', false],
  ['smartcardrequired', 'Smart Card Required', false],
  ['unconstraineddelegation', 'Unconstrained Delegation', false],
  ['admincount', 'Admin Count', false],
  ['adminsdholderprotected', 'AdminSDHolder Protected', false],
  ['isaclprotected', 'ACL Protected', false],
  ['supportedencryptiontypes', 'Supported Encryption Types', false],
  timeColumnDef('lastlogontimestamp', 'Logon TS', 'Last Logon Timestamp', false, '128px'),
  ['serviceprincipalnames', 'Service Principal Names', false],
  ['primary_group_sid', 'Primary Group SID', false],
  ['distinguishedname', 'Distinguished Name', false],
  ['objectguid', 'Object GUID', false],
]);

const GROUP_COLUMNS = normalizeColumnDefs([
  ['name', 'Name', true],
  ['samaccountname', 'SAM Name', true],
  { key: 'sid', title: 'SID', filter_title: 'SID', default_visible: true, width: '76px' },
  ['domain', 'Domain', true],
  ['scope', 'Scope', true],
  ['member_count', 'Member Count', true],
  timeColumnDef('whencreated', 'Created on', 'When Created', true, '128px'),
  ['description', 'Description', true],
  ['admincount', 'Admin Count', false],
  ['adminsdholderprotected', 'AdminSDHolder Protected', false],
  ['isaclprotected', 'ACL Protected', false],
  ['distinguishedname', 'Distinguished Name', false],
  ['objectguid', 'Object GUID', false],
  ['sidhistory', 'SID History', false],
]);

const COMPUTER_COLUMNS = normalizeColumnDefs([
  ['name', 'Name', true],
  ['samaccountname', 'SAM Name', true],
  { key: 'sid', title: 'SID', filter_title: 'SID', default_visible: true, width: '76px' },
  ['domain', 'Domain', true],
  ['operatingsystem', 'Operating System', true],
  ['flag', 'Flags', true],
  ['isdc', 'Is DC', true],
  timeColumnDef('whencreated', 'Created on', 'When Created', true, '128px'),
  timeColumnDef('lastlogon', 'Last Logon', 'Last Logon', true, '128px'),
  timeColumnDef('pwdlastset', 'Password Set', 'Password Last Set', true, '132px'),
  ['description', 'Description', true],
  ['isreadonlydc', 'Is Read-Only DC', false],
  ['haslaps', 'Has LAPS', false],
  ['lockedout', 'Locked Out', false],
  ['unconstraineddelegation', 'Unconstrained Delegation', false],
  ['trustedtoauth', 'Trusted To Auth', false],
  ['admincount', 'Admin Count', false],
  ['supportedencryptiontypes', 'Supported Encryption Types', false],
  timeColumnDef('lastlogontimestamp', 'Logon TS', 'Last Logon Timestamp', false, '128px'),
  ['serviceprincipalnames', 'Service Principal Names', false],
  ['primary_group_sid', 'Primary Group SID', false],
  ['distinguishedname', 'Distinguished Name', false],
  ['objectguid', 'Object GUID', false],
]);

const DOMAIN_COLUMNS = normalizeColumnDefs([
  ['name', 'Name', true],
  ['domain', 'Domain', true],
  ['netbios', 'NetBIOS', true],
  ['domainsid', 'Domain SID', true],
  ['functionallevel', 'Functional Level', true],
  ['flag', 'Flags', true],
  ['minpwdlength', 'Min Password Length', true],
  ['pwdhistorylength', 'Password History Length', true],
  ['lockoutthreshold', 'Lockout Threshold', true],
  ['maxpwdage', 'Max Password Age', true],
  ['minpwdage', 'Min Password Age', true],
  ['machineaccountquota', 'Machine Account Quota', true],
  timeColumnDef('whencreated', 'Created on', 'When Created', true, '128px'),
  ['distinguishedname', 'Distinguished Name', false],
  ['objectguid', 'Object GUID', false],
  ['pwdproperties', 'Password Properties', false],
  ['lockoutduration', 'Lockout Duration', false],
  ['lockoutobservationwindow', 'Lockout Observation Window', false],
  ['expirepasswordsonsmartcardonlyaccounts', 'Expire Passwords On Smartcard Only', false],
  ['dsheuristics', 'DS Heuristics', false],
  ['collected', 'Collected', false],
]);

const ALL_COLUMNS = {
  users: USER_COLUMNS,
  groups: GROUP_COLUMNS,
  computers: COMPUTER_COLUMNS,
  domains: DOMAIN_COLUMNS,
};

const TITLE_PAIRS = {
  User: USER_COLUMNS.map((column) => [column.key, column.title]),
  Group: GROUP_COLUMNS.map((column) => [column.key, column.title]),
  Computer: COMPUTER_COLUMNS.map((column) => [column.key, column.title]),
  Domain: DOMAIN_COLUMNS.map((column) => [column.key, column.title]),
};

module.exports = {
  ALL_COLUMNS,
  USER_COLUMNS,
  GROUP_COLUMNS,
  COMPUTER_COLUMNS,
  DOMAIN_COLUMNS,
  TITLE_PAIRS,
};
