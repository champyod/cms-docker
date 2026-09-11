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
  'appearance',
  'env',
  'settings',
  'resource',
];

// Why: domain verbs beyond CRUD, kept as module/verb pairs so every derived key is
// `${module}:${verb}`; verbs already covered by CRUD (audit:read, container:read)
// are deduped during the build so the registry stays key-unique.
const DOMAIN_VERBS: readonly { module: string; verb: string }[] = [
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

  for (const module of MODULES) {
    for (const verb of STANDARD_VERBS) push(module, verb);
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

function crud(module: string): string[] {
  return STANDARD_VERBS.map((verb) => `${module}:${verb}`);
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
      'resource:list',
      'resource:read',
      'resource:update',
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
