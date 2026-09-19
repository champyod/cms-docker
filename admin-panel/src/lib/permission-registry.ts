// Key grammar: `${module}:${verb}`. Most keys come from MODULES x STANDARD_VERBS.
// DOMAIN_VERBS adds compound verbs (`admin:password:update`) and domain-only
// modules (`password`, `override`) that are deliberately absent from MODULES.
// `all:all` is appended explicitly as the audited wildcard, not a bypass.
export interface PermissionDefinition {
  key: string;
  module: string;
  verb: string;
  description: string;
}

export interface GroupDefinition {
  name: string;
  description: string;
  permissions: readonly string[];
}

const STANDARD_VERBS: readonly string[] = ['list', 'create', 'read', 'update', 'delete'];

const MODULES: readonly string[] = [
  'admin',
  'group',
  'permission',
  'audit',
  'contest',
  'task',
  'dataset',
  'testcase',
  'statement',
  'attachment',
  'submission',
  'submissionresult',
  'evaluation',
  'executable',
  'file',
  'manager',
  'fsobject',
  'token',
  'user',
  'team',
  'participation',
  'usertest',
  'question',
  'message',
  'announcement',
  'monitor',
  'container',
  'service',
  'deployment',
  'ranking',
  'maintenance',
  'backup',
  'appearance',
  'env',
  'settings',
  'resource',
];

// Why: domain verbs beyond CRUD, kept as module/verb pairs so every derived key is
// `${module}:${verb}`; verbs already covered by CRUD (audit:read, container:read)
// are deduped during the build so the registry stays key-unique.
const DOMAIN_VERBS: readonly { module: string; verb: string }[] = [
  { module: 'admin', verb: 'password:update' },
  { module: 'contest', verb: 'switch' },
  { module: 'task', verb: 'switch_dataset' },
  { module: 'dataset', verb: 'switch' },
  { module: 'submission', verb: 'rejudge' },
  { module: 'submission', verb: 'download' },
  { module: 'submission', verb: 'recompute' },
  { module: 'token', verb: 'issue' },
  { module: 'token', verb: 'revoke' },
  { module: 'question', verb: 'answer' },
  { module: 'question', verb: 'ignore' },
  { module: 'message', verb: 'send' },
  { module: 'announcement', verb: 'publish' },
  { module: 'password', verb: 'reveal' },
  { module: 'container', verb: 'read' },
  { module: 'container', verb: 'control' },
  { module: 'service', verb: 'restart' },
  { module: 'service', verb: 'deploy' },
  { module: 'deployment', verb: 'deploy' },
  { module: 'ranking', verb: 'snapshot' },
  { module: 'maintenance', verb: 'enable' },
  { module: 'maintenance', verb: 'disable' },
  { module: 'appearance', verb: 'update' },
  { module: 'monitor', verb: 'test' },
  { module: 'audit', verb: 'read' },
  { module: 'group', verb: 'assign' },
  { module: 'override', verb: 'set' },
];

function describePermission(module: string, verb: string): string {
  return `Allow "${verb}" operations on the "${module}" module.`;
}

function buildRegistry(): PermissionDefinition[] {
  const definitions: PermissionDefinition[] = [];
  const seen = new Set<string>();

  const push = (module: string, verb: string): void => {
    const key = `${module}:${verb}`;
    if (seen.has(key)) return;
    seen.add(key);
    definitions.push({ key, module, verb, description: describePermission(module, verb) });
  };

  for (const moduleName of MODULES) {
    for (const verb of STANDARD_VERBS) push(moduleName, verb);
  }
  for (const { module, verb } of DOMAIN_VERBS) push(module, verb);

  definitions.push({
    key: 'all:all',
    module: 'all',
    verb: 'all',
    description: 'Grant every permission in the registry.',
  });

  return definitions;
}

export const PERMISSION_REGISTRY: readonly PermissionDefinition[] = buildRegistry();

// Why this list exists: these keys describe capabilities no check enforces yet —
// verified by grepping every gate call (ensurePermission, checkPermission,
// verifyApiPermission, requirePermission, hasEffectivePermission) across src.
// Granting a reserved key confers nothing until a check enforces it; existing
// group grants are left untouched so wiring them later is additive, not a fix.
// Whole modules are reserved because no backend path references any of their
// keys; task:switch_dataset is reserved because the field map and the dataset
// switch action both enforce dataset:switch instead.
const RESERVED_MODULES: readonly { module: string; reason: string }[] = [
  { module: 'evaluation', reason: 'No evaluation path checks these keys.' },
  { module: 'executable', reason: 'No executable path checks these keys.' },
  { module: 'file', reason: 'No file path checks these keys.' },
  { module: 'submissionresult', reason: 'No submission-result path checks these keys.' },
  { module: 'token', reason: 'No token path checks these keys.' },
  { module: 'usertest', reason: 'No user-test path checks these keys.' },
  { module: 'permission', reason: 'No permission-admin path checks these keys.' },
];

const RESERVED_KEYS: readonly { key: string; reason: string }[] = [
  { key: 'token:issue', reason: 'No issuance path checks this key.' },
  { key: 'token:revoke', reason: 'No revocation path checks this key.' },
  { key: 'task:switch_dataset', reason: 'Superseded by dataset:switch.' },
];

export interface ReservedPermission {
  key: string;
  reason: string;
}

function buildReserved(): readonly ReservedPermission[] {
  const reserved: ReservedPermission[] = [];
  for (const { module, reason } of RESERVED_MODULES) {
    for (const verb of STANDARD_VERBS) reserved.push({ key: `${module}:${verb}`, reason });
  }
  for (const entry of RESERVED_KEYS) reserved.push(entry);
  return reserved;
}

export const RESERVED_PERMISSIONS: readonly ReservedPermission[] = buildReserved();

function crud(moduleName: string): string[] {
  return STANDARD_VERBS.map((verb) => `${moduleName}:${verb}`);
}

export const DEFAULT_GROUPS: readonly GroupDefinition[] = [
  {
    name: 'Superadmin',
    description: 'Unrestricted access to every permission in the registry.',
    permissions: PERMISSION_REGISTRY.map((definition) => definition.key),
  },
  {
    name: 'Contest Manager',
    description: 'Runs contests end to end, from creation through ranking.',
    permissions: [
      ...crud('contest'),
      'contest:switch',
      'task:list',
      'task:create',
      'task:read',
      'task:update',
      'task:delete',
      'task:switch_dataset',
      'participation:list',
      'participation:create',
      'participation:read',
      'participation:update',
      'participation:delete',
      'dataset:list',
      'dataset:read',
      'dataset:switch',
      'statement:list',
      'statement:read',
      'statement:update',
      'submission:list',
      'submission:read',
      'ranking:list',
      'ranking:read',
      'ranking:snapshot',
      'testcase:list',
      'testcase:read',
      'user:list',
      'user:read',
      'team:list',
      'team:read',
      'question:list',
      'question:read',
      'question:answer',
      'message:list',
      'message:read',
      'message:send',
      'announcement:list',
      'announcement:read',
      'announcement:create',
      'announcement:update',
      'announcement:publish',
    ],
  },
  {
    name: 'Problem Setter',
    description: 'Authors tasks, datasets, statements and test data.',
    permissions: [
      ...crud('task'),
      'task:switch_dataset',
      ...crud('dataset'),
      'dataset:switch',
      ...crud('testcase'),
      ...crud('statement'),
      ...crud('attachment'),
      ...crud('evaluation'),
      'contest:list',
      'contest:read',
      'submission:list',
      'submission:read',
      'executable:list',
      'executable:read',
    ],
  },
  {
    name: 'Judge',
    description: 'Reviews and reprocesses submissions and evaluations.',
    permissions: [
      'contest:list',
      'contest:read',
      'task:list',
      'task:read',
      'submission:list',
      'submission:create',
      'submission:read',
      'submission:rejudge',
      'submission:download',
      'submission:recompute',
      'submissionresult:list',
      'submissionresult:read',
      'evaluation:list',
      'evaluation:read',
      'ranking:list',
      'ranking:read',
      'user:list',
      'user:read',
    ],
  },
  {
    name: 'Viewer',
    description: 'Read-only access to public contest data.',
    permissions: [
      'contest:list',
      'contest:read',
      'task:list',
      'task:read',
      'submission:list',
      'submission:read',
      'ranking:list',
      'ranking:read',
      'user:list',
      'user:read',
      'team:list',
      'team:read',
      'participation:list',
      'participation:read',
      'announcement:list',
      'announcement:read',
    ],
  },
  {
    name: 'Data Correction',
    description: 'Repairs submissions, evaluations and participant records.',
    permissions: [
      'contest:list',
      'contest:read',
      'submission:list',
      'submission:read',
      'submission:rejudge',
      'submission:download',
      'submission:recompute',
      'submissionresult:list',
      'submissionresult:read',
      'submissionresult:update',
      'evaluation:list',
      'evaluation:read',
      'evaluation:update',
      'user:list',
      'user:read',
      'user:update',
      'team:list',
      'team:create',
      'team:read',
      'team:update',
      'participation:list',
      'participation:create',
      'participation:read',
      'participation:update',
    ],
  },
  {
    name: 'Storage Admin',
    description: 'Manages files, objects and container/service infrastructure.',
    permissions: [
      ...crud('file'),
      ...crud('fsobject'),
      ...crud('attachment'),
      ...crud('executable'),
      'dataset:read',
      'container:read',
      'container:control',
      'service:restart',
      'service:deploy',
      'deployment:list',
      'deployment:read',
      'deployment:deploy',
      // Why: a deploy is only finished once it activates its contest, and activation is gated on
      // contest:switch (lib/services/contests.ts). Whoever may deploy must therefore be able to
      // activate, or the deploy succeeds and its activation fails.
      'contest:switch',
      'resource:list',
      'resource:read',
      'resource:update',
      // Why no backup:delete here: deleted archives cannot be restored, so
      // deletion stays Superadmin-only while operate keys are delegable.
      'backup:list',
      'backup:read',
      'backup:create',
      'backup:update',
    ],
  },
  {
    name: 'Messaging',
    description: 'Handles clarifications, messages and announcements.',
    permissions: [
      ...crud('message'),
      'message:send',
      ...crud('announcement'),
      'announcement:publish',
      'question:list',
      'question:read',
      'question:answer',
      'question:ignore',
      'user:list',
      'user:read',
      'contest:list',
      'contest:read',
    ],
  },
];
