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
  // Why domain verbs, not a module: only list/read/create exist as actions.
  // backup:update/delete are never minted, so no group — not even Superadmin
  // via explicit grant — can hold them; destructive paths stay unbuilt.
  { module: 'backup', verb: 'list' },
  { module: 'backup', verb: 'read' },
  { module: 'backup', verb: 'create' },
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

// Why this list exists: these exact keys describe capabilities with no admin
// path — rows are written by workers (compile/evaluate), the contest flow
// (token consumption, user-test runs) or the seed (permission rows). Every
// other registry key must be enforced by at least one gate call
// (ensurePermission, checkPermission, verifyApiPermission, requirePermission,
// hasEffectivePermission) or field-map entry; the coverage test enforces that.
// task:switch_dataset left this list by being wired into assignTaskToContest
// and activateDataset; evaluation/submissionresult delete left it via recalculate.
const RESERVED_KEYS: readonly { key: string; reason: string }[] = [
  { key: 'evaluation:create', reason: 'Worker creates evaluation rows on scoring.' },
  { key: 'evaluation:update', reason: 'Worker updates evaluation rows on scoring.' },
  { key: 'submissionresult:create', reason: 'Worker creates result rows on scoring.' },
  { key: 'submissionresult:update', reason: 'Worker updates result rows on scoring.' },
  { key: 'executable:create', reason: 'Worker creates build artifacts on recompile.' },
  { key: 'executable:update', reason: 'Worker refreshes build artifacts on recompile.' },
  { key: 'executable:delete', reason: 'Worker replaces build artifacts on recompile.' },
  { key: 'file:create', reason: 'Contest flow stores submitted files on upload.' },
  { key: 'file:update', reason: 'Contest flow refreshes stored files on resubmit.' },
  { key: 'file:delete', reason: 'Worker replaces stored files on recompile.' },
  { key: 'token:create', reason: 'Contest flow records consumed tokens automatically.' },
  { key: 'token:update', reason: 'Contest flow owns token rows; admins never edit them.' },
  { key: 'token:delete', reason: 'Contest flow owns token rows; admins never remove them.' },
  { key: 'token:issue', reason: 'No issuance path checks this key.' },
  { key: 'token:revoke', reason: 'No revocation path checks this key.' },
  { key: 'usertest:create', reason: 'Contestants create user-test runs.' },
  { key: 'usertest:update', reason: 'Contest flow owns user-test rows; admins never edit them.' },
  { key: 'usertest:delete', reason: 'Contest flow owns user-test rows; admins never remove them.' },
  { key: 'permission:create', reason: 'Seed manages permission rows; admins never create them.' },
  { key: 'permission:update', reason: 'Seed manages permission rows; admins never edit them.' },
  { key: 'permission:delete', reason: 'Seed manages permission rows; admins never remove them.' },
  { key: 'audit:create', reason: 'System appends audit rows on every action; admins never write them directly.' },
  { key: 'audit:update', reason: 'Audit log is immutable; no update path exists by design.' },
  { key: 'audit:delete', reason: 'Audit log is immutable; no delete path exists by design.' },
  { key: 'appearance:create', reason: 'Single config file updated in place; no create path exists.' },
  { key: 'appearance:delete', reason: 'Single config file updated in place; no delete path exists.' },
  { key: 'attachment:update', reason: 'Attachments upsert via the create path; no update path exists.' },
  { key: 'container:create', reason: 'Containers come from compose; no admin create path exists.' },
  { key: 'container:delete', reason: 'Containers come from compose; no admin delete path exists.' },
  { key: 'deployment:create', reason: 'Deploy operations are spawned by deploy, not created as rows.' },
  { key: 'deployment:update', reason: 'Deploy operations are immutable once spawned.' },
  { key: 'deployment:delete', reason: 'Deploy operations are settled, never deleted via UI.' },
  { key: 'env:create', reason: 'Fixed env file set updated in place; no create path exists.' },
  { key: 'env:delete', reason: 'Fixed env file set updated in place; no delete path exists.' },
  { key: 'fsobject:list', reason: 'Storage layer read via statement/attachment flows; no list path exists.' },
  { key: 'fsobject:create', reason: 'Storage layer written via storeFile inside statement/attachment flows.' },
  { key: 'fsobject:update', reason: 'Content-addressed blobs are immutable; no update path exists.' },
  { key: 'fsobject:delete', reason: 'Content-addressed blobs are never deleted via UI.' },
  { key: 'maintenance:list', reason: 'No maintenance rows exist; operations only.' },
  { key: 'maintenance:read', reason: 'No maintenance rows exist; operations only.' },
  { key: 'maintenance:create', reason: 'No maintenance rows exist; operations only.' },
  { key: 'maintenance:delete', reason: 'No maintenance rows exist; operations only.' },
  { key: 'maintenance:disable', reason: 'No disable path exists; enable/disable split kept for parity.' },
  { key: 'manager:update', reason: 'Managers upsert via the create path; no update path exists.' },
  { key: 'message:update', reason: 'Messages are immutable once sent; no update path exists.' },
  { key: 'message:delete', reason: 'Messages are immutable once sent; no delete path exists.' },
  { key: 'question:create', reason: 'Contestants ask questions; admins only answer or ignore.' },
  { key: 'question:update', reason: 'Replies write via the answer path; no generic update exists.' },
  { key: 'question:delete', reason: 'Questions are never deleted via UI.' },
  { key: 'ranking:create', reason: 'Ranking rows are computed, never created via UI.' },
  { key: 'ranking:delete', reason: 'Ranking rows are computed, never deleted via UI.' },
  { key: 'resource:create', reason: 'Resources are discovered, never created via UI.' },
  { key: 'resource:update', reason: 'Resources are discovered, never updated via UI.' },
  { key: 'resource:delete', reason: 'Resources are discovered, never deleted via UI.' },
  { key: 'service:create', reason: 'Services come from compose; no admin create path exists.' },
  { key: 'service:update', reason: 'Services come from compose; no admin update path exists.' },
  { key: 'service:delete', reason: 'Services come from compose; no admin delete path exists.' },
  { key: 'settings:create', reason: 'Fixed config keys updated in place; no create path exists.' },
  { key: 'settings:delete', reason: 'Fixed config keys updated in place; no delete path exists.' },
  { key: 'submission:create', reason: 'Contestants submit; admins never create submissions.' },
  { key: 'submission:delete', reason: 'Submissions are immutable; admins never delete them.' },
  { key: 'maintenance:enable', reason: 'Enable fallback retired; triggerManualBackup enforces strict backup:create instead.' },
  { key: 'backup:read', reason: 'Backup rows listed via backup:list; no single-read path exists.' },
];

export interface ReservedPermission {
  key: string;
  reason: string;
}

function buildReserved(): readonly ReservedPermission[] {
  return RESERVED_KEYS.map((entry) => ({ ...entry }));
}

export const RESERVED_PERMISSIONS: readonly ReservedPermission[] = buildReserved();

// DEFAULT_GROUPS lives in './permission-groups' (split for the 250-line limit).
