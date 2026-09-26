import { hasEffectivePermission } from '@/lib/permission-engine';
import type { PermissionKey } from '@/lib/permissions';
import { EXTRA_FIELD_PERMISSION_MAP } from '@/lib/field-permission-tables';

export type FieldAccess = { canRead: boolean; canUpdate: boolean };

export interface FieldPermissionDef {
  read: PermissionKey;
  update?: PermissionKey;
}

// Why: defines which permission keys gate read and update access for each field of each entity.
// Other entities (users, contests, …) adopt this same pattern by adding their own top-level entry.
export const FIELD_PERMISSION_MAP: Record<string, Record<string, FieldPermissionDef>> = {
  admins: {
    id: { read: 'admin:read' },
    name: { read: 'admin:read', update: 'admin:update' },
    username: { read: 'admin:read' },
    authentication: { read: 'password:reveal', update: 'admin:password:update' },
    password: { read: 'password:reveal', update: 'admin:password:update' },
    enabled: { read: 'admin:read', update: 'admin:update' },
    last_login_at: { read: 'audit:read' },
    admin_groups: { read: 'group:read', update: 'group:assign' },
    permission_overrides: { read: 'permission:read', update: 'override:set' },
  },
  submissions: {
    id: { read: 'submission:read' },
    opaque_id: { read: 'submission:read' },
    participation_id: { read: 'submission:read' },
    task_id: { read: 'submission:read' },
    timestamp: { read: 'submission:read' },
    language: { read: 'submission:read' },
    comment: { read: 'submission:read', update: 'submission:update' },
    official: { read: 'submission:read', update: 'submission:update' },
    submission_results: { read: 'submissionresult:read' },
    files: { read: 'file:read' },
    evaluations: { read: 'evaluation:read' },
    executables: { read: 'executable:read' },
    tokens: { read: 'token:read' },
  },
  datasets: {
    id: { read: 'dataset:read' },
    task_id: { read: 'dataset:read' },
    description: { read: 'dataset:read', update: 'dataset:update' },
    autojudge: { read: 'dataset:read', update: 'dataset:update' },
    time_limit: { read: 'dataset:read', update: 'dataset:update' },
    memory_limit: { read: 'dataset:read', update: 'dataset:update' },
    task_type: { read: 'dataset:read', update: 'dataset:update' },
    task_type_parameters: { read: 'dataset:read', update: 'dataset:update' },
    score_type: { read: 'dataset:read', update: 'dataset:update' },
    score_type_parameters: { read: 'dataset:read', update: 'dataset:update' },
  },
  users: {
    id: { read: 'user:read' },
    first_name: { read: 'user:read', update: 'user:update' },
    last_name: { read: 'user:read', update: 'user:update' },
    username: { read: 'user:read', update: 'user:update' },
    password: { read: 'password:reveal', update: 'user:update' },
    email: { read: 'user:read', update: 'user:update' },
    timezone: { read: 'user:read', update: 'user:update' },
    preferred_languages: { read: 'user:read', update: 'user:update' },
    last_login_at: { read: 'audit:read' },
    status: { read: 'user:read', update: 'user:update' },
    organization: { read: 'user:read', update: 'user:update' },
    country: { read: 'user:read', update: 'user:update' },
    participations: { read: 'participation:list' },
    led_teams: { read: 'team:list' },
  },
  teams: {
    id: { read: 'team:read' },
    code: { read: 'team:read', update: 'team:update' },
    name: { read: 'team:read', update: 'team:update' },
    organization: { read: 'team:read', update: 'team:update' },
    leader_id: { read: 'team:read', update: 'team:update' },
    participations: { read: 'participation:list' },
  },
  tasks: {
    id: { read: 'task:read' },
    num: { read: 'task:read' },
    contest_id: { read: 'task:read', update: 'task:update' },
    name: { read: 'task:read', update: 'task:update' },
    title: { read: 'task:read', update: 'task:update' },
    submission_format: { read: 'task:read', update: 'task:update' },
    primary_statements: { read: 'task:read' },
    allowed_languages: { read: 'task:read', update: 'task:update' },
    token_mode: { read: 'task:read', update: 'task:update' },
    token_max_number: { read: 'task:read', update: 'task:update' },
    token_min_interval: { read: 'task:read', update: 'task:update' },
    token_gen_initial: { read: 'task:read', update: 'task:update' },
    token_gen_number: { read: 'task:read', update: 'task:update' },
    token_gen_interval: { read: 'task:read', update: 'task:update' },
    token_gen_max: { read: 'task:read', update: 'task:update' },
    max_submission_number: { read: 'task:read', update: 'task:update' },
    max_user_test_number: { read: 'task:read', update: 'task:update' },
    min_submission_interval: { read: 'task:read', update: 'task:update' },
    min_user_test_interval: { read: 'task:read', update: 'task:update' },
    feedback_level: { read: 'task:read', update: 'task:update' },
    score_precision: { read: 'task:read', update: 'task:update' },
    score_mode: { read: 'task:read', update: 'task:update' },
    active_dataset_id: { read: 'task:read', update: 'dataset:switch' },
  },
  testcases: {
    id: { read: 'testcase:read' },
    dataset_id: { read: 'testcase:read' },
    codename: { read: 'testcase:read', update: 'testcase:update' },
    public: { read: 'testcase:read', update: 'testcase:update' },
    input: { read: 'testcase:read', update: 'testcase:update' },
    output: { read: 'testcase:read', update: 'testcase:update' },
  },
  participations: {
    id: { read: 'participation:read' },
    ip: { read: 'participation:read', update: 'participation:update' },
    starting_time: { read: 'participation:read', update: 'participation:update' },
    delay_time: { read: 'participation:read', update: 'participation:update' },
    extra_time: { read: 'participation:read', update: 'participation:update' },
    delay_time_seconds: { read: 'participation:read', update: 'participation:update' },
    extra_time_seconds: { read: 'participation:read', update: 'participation:update' },
    password: { read: 'password:reveal', update: 'participation:update' },
    passwordKind: { read: 'participation:read', update: 'participation:update' },
    hidden: { read: 'participation:read', update: 'participation:update' },
    unrestricted: { read: 'participation:read', update: 'participation:update' },
    contest_id: { read: 'participation:read' },
    user_id: { read: 'participation:read' },
    team_id: { read: 'participation:read', update: 'participation:update' },
    user_tests: { read: 'usertest:read' },
  },
  announcements: {
    id: { read: 'announcement:read' },
    timestamp: { read: 'announcement:read' },
    subject: { read: 'announcement:read', update: 'announcement:update' },
    text: { read: 'announcement:read', update: 'announcement:update' },
    contest_id: { read: 'announcement:read' },
    admin_id: { read: 'announcement:read' },
  },
  questions: {
    id: { read: 'question:read' },
    question_timestamp: { read: 'question:read' },
    subject: { read: 'question:read' },
    text: { read: 'question:read' },
    reply_timestamp: { read: 'question:read' },
    ignored: { read: 'question:read', update: 'question:ignore' },
    reply_subject: { read: 'question:read', update: 'question:answer' },
    reply_text: { read: 'question:read', update: 'question:answer' },
    participation_id: { read: 'question:read' },
    admin_id: { read: 'question:read', update: 'question:answer' },
  },
  statements: {
    id: { read: 'statement:read' },
    task_id: { read: 'statement:read' },
    language: { read: 'statement:read', update: 'statement:update' },
    digest: { read: 'statement:read', update: 'statement:update' },
  },
  monitor_targets: {
    id: { read: 'monitor:read' },
    url: { read: 'monitor:read', update: 'monitor:update' },
    interval: { read: 'monitor:read', update: 'monitor:update' },
    timeout: { read: 'monitor:read', update: 'monitor:update' },
    expectedStatus: { read: 'monitor:read', update: 'monitor:update' },
    alertDiscord: { read: 'monitor:read', update: 'monitor:update' },
    enabled: { read: 'monitor:read', update: 'monitor:update' },
    createdAt: { read: 'monitor:read' },
    updatedAt: { read: 'monitor:read' },
  },
  ...EXTRA_FIELD_PERMISSION_MAP,
};

/** Returns per-field read/update booleans for the given entity, evaluated against effectivePermissions. */
export function getFieldAccess(
  entity: string,
  effectivePermissions: ReadonlySet<string>,
): Record<string, FieldAccess> {
  const map = FIELD_PERMISSION_MAP[entity];
  if (!map) return {};

  const result: Record<string, FieldAccess> = {};
  for (const field of Object.keys(map)) {
    const def = map[field];
    result[field] = {
      canRead: hasEffectivePermission(effectivePermissions, def.read),
      canUpdate: def.update ? hasEffectivePermission(effectivePermissions, def.update) : false,
    };
  }
  return result;
}

function pickAllowedFields<T extends Record<string, unknown>>(
  data: T,
  access: Record<string, FieldAccess>,
  gate: 'canRead' | 'canUpdate',
): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (access[key]?.[gate]) result[key] = data[key];
  }
  return result as Partial<T>;
}

/** Returns only the keys of data that the caller has read permission for. */
export function filterReadableFields<T extends Record<string, unknown>>(
  entity: string,
  data: T,
  effectivePermissions: ReadonlySet<string>,
): Partial<T> {
  return filterReadableFieldsWith(getFieldAccess(entity, effectivePermissions), data);
}

/** Returns the readable keys of data from an access table the caller already built for the batch. */
export function filterReadableFieldsWith<T extends Record<string, unknown>>(
  access: Record<string, FieldAccess>,
  data: T,
): Partial<T> {
  return pickAllowedFields(data, access, 'canRead');
}

/** Returns only the keys of data that the caller has update permission for. */
export function stripDisallowedFields<T extends Record<string, unknown>>(
  entity: string,
  data: T,
  effectivePermissions: ReadonlySet<string>,
): Partial<T> {
  return pickAllowedFields(data, getFieldAccess(entity, effectivePermissions), 'canUpdate');
}
