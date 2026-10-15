import { PERMISSION_REGISTRY, type GroupDefinition } from './permission-registry';
import {
  ADMIN_LOGIN,
  compose,
  crud,
  EVALUATION_TRIAGE,
  LOCKOUT_READS,
  MESSAGE_ACCESS,
  MESSAGING_ACCESS,
  PUBLIC_READS,
  QUESTION_ACCESS,
  RANKING_CONTROL,
  reads,
  SECURITY_ACCESS,
  SUBMISSION_ARTIFACTS,
  SUBMISSION_REVIEW,
} from './permission-group-blocks';

// Split from the registry so there is no registry↔groups cycle, and from the
// capability blocks so neither module grows past the 250-line limit.
export type { GroupDefinition };

/**
 * The system actor that owns every script-side action: the seeded `root` admin
 * and the group that carries every registry key for it. Name-keyed like
 * Superadmin, and for the same reason — the guards that refuse deleting or
 * editing the actor anchor on these strings, so the audit trail keeps an
 * attribution target that cannot be destroyed through the panel.
 */
export const ROOT_ACTOR_USERNAME = 'root';
export const ROOT_ACTOR_GROUP_NAME = 'root';

export const DEFAULT_GROUPS: readonly GroupDefinition[] = [
  {
    name: 'Superadmin',
    description: 'Unrestricted access to every permission in the registry.',
    // backup:schedule stays out: the engine carve-out keeps it out of all:all, so
    // scheduling a recurring backup is always a deliberate per-admin grant.
    permissions: PERMISSION_REGISTRY.map((definition) => definition.key).filter(
      (key) => key !== 'backup:schedule',
    ),
  },
  {
    name: 'Contest Manager',
    description: 'Runs contests end to end, from creation through ranking.',
    permissions: compose(
      ADMIN_LOGIN,
      PUBLIC_READS,
      crud('contest'),
      'contest:switch',
      crud('task'),
      'task:switch_dataset',
      crud('participation'),
      'dataset:read',
      'dataset:switch',
      compose(reads('statement'), 'statement:update'),
      'evaluation:list',
      'evaluation:lane_assign',
      'evaluation:lane_move',
      RANKING_CONTROL,
      reads('testcase'),
      'user:update',
      'team:update',
      QUESTION_ACCESS,
      MESSAGE_ACCESS,
      'announcement:create',
      'announcement:update',
      'announcement:publish',
      crud('contestant_group'),
      'username:policy:read',
      'username:policy:update',
      'username:set',
    ),
  },
  {
    name: 'Problem Setter',
    description: 'Authors tasks, datasets, statements and test data.',
    permissions: compose(
      ADMIN_LOGIN,
      crud('task'),
      'task:switch_dataset',
      crud('dataset', ['list']),
      'dataset:switch',
      crud('testcase'),
      crud('statement'),
      crud('attachment', ['update']),
      EVALUATION_TRIAGE,
      'evaluation:lane_assign',
      'evaluation:lane_move',
      reads('contest'),
      SUBMISSION_REVIEW,
      'submissionresult:read',
      'submissionresult:delete',
      reads('executable'),
      reads('file'),
      'fsobject:read',
      crud('manager', ['update']),
      reads('token'),
    ),
  },
  {
    name: 'Judge',
    description: 'Reviews and reprocesses submissions and evaluations.',
    permissions: compose(
      ADMIN_LOGIN,
      reads('contest'),
      reads('task'),
      SUBMISSION_REVIEW,
      'submission:update',
      'submissionresult:read',
      'submissionresult:delete',
      EVALUATION_TRIAGE,
      'evaluation:lane_assign',
      'evaluation:lane_move',
      SUBMISSION_ARTIFACTS,
      reads('attachment'),
      reads('ranking'),
      reads('user'),
    ),
  },
  {
    name: 'Data Correction',
    description: 'Repairs submissions, evaluations and participant records.',
    permissions: compose(
      ADMIN_LOGIN,
      reads('contest'),
      SUBMISSION_REVIEW,
      'submissionresult:read',
      'submissionresult:delete',
      EVALUATION_TRIAGE,
      SUBMISSION_ARTIFACTS,
      reads('user'),
      'user:update',
      reads('team'),
      'team:create',
      'team:update',
      reads('participation'),
      'participation:create',
      'participation:update',
    ),
  },
  {
    name: 'Messaging',
    description: 'Handles clarifications, messages and announcements.',
    permissions: compose(ADMIN_LOGIN, MESSAGING_ACCESS, reads('contest'), reads('user')),
  },
  {
    name: 'Viewer',
    description: 'Read-only access to public contest data.',
    permissions: compose(ADMIN_LOGIN, PUBLIC_READS),
  },
  {
    name: 'Storage',
    description: 'Manages files, objects and container/service infrastructure.',
    permissions: compose(
      ADMIN_LOGIN,
      reads('file'),
      'fsobject:read',
      crud('attachment', ['update']),
      reads('executable'),
      'dataset:read',
      'container:read',
      'container:control',
      'service:restart',
      'service:deploy',
      'deployment:list',
      'deployment:read',
      'deployment:deploy',
      // The deployments page gates on its own read set, so this operator holds every key it names.
      'contest:list',
      'task:read',
      reads('env'),
      reads('settings'),
      // The maintenance archive view and the backups API both gate on backup:list.
      'backup:list',
      // A deploy finishes by activating its contest, which is gated on contest:switch.
      'contest:switch',
      reads('resource'),
    ),
  },
  {
    name: 'Security',
    description: 'Runs the security surface: WAF, blocked addresses, lockouts and certificates.',
    permissions: compose(ADMIN_LOGIN, SECURITY_ACCESS),
  },
  {
    name: 'Ranking Operator',
    description: 'Operates the public ranking surface and cannot sign in to this web server.',
    // No admin:login: the login gate requires it, so members hold ranking rights without the panel.
    permissions: compose(reads('ranking'), 'ranking:update', RANKING_CONTROL, LOCKOUT_READS),
  },
  {
    name: 'Scoreboard Console',
    description: 'Signs in to the ranking board and reads the scoreboard.',
    // Kept in code so the seed reconciles the links the ranking-console migration wrote.
    permissions: ['ranking:read'],
  },
  {
    name: 'Participant Manager',
    description: 'Manages participants: accounts, participation, dataset managers, messages and user tests.',
    // No admin:login: the row this group renames never held the gate.
    permissions: compose(
      crud('user'),
      crud('participation'),
      crud('manager', ['update']),
      MESSAGE_ACCESS,
      reads('usertest'),
      reads('file'),
    ),
  },
  {
    name: 'Administrator',
    description: 'Administers admins, groups, permissions, the audit trail and overrides.',
    permissions: compose(
      ADMIN_LOGIN,
      crud('admin'),
      'admin:password:update',
      crud('group'),
      'group:assign',
      reads('permission'),
      reads('audit'),
      'override:set',
    ),
  },
  {
    name: 'Backup Operator',
    description: 'Runs backups and restores, scheduled ones included.',
    permissions: compose(
      ADMIN_LOGIN,
      'backup:list',
      'backup:create',
      'backup:restore',
      'backup:settle',
      'backup:delete',
      'backup:schedule',
    ),
  },
  {
    name: 'System Operator',
    description: 'Tends appearance, maintenance, monitoring, environment files and settings.',
    permissions: compose(
      ADMIN_LOGIN,
      compose(reads('appearance'), 'appearance:update'),
      'maintenance:update',
      compose(reads('monitor'), 'monitor:test'),
      reads('env'),
      reads('settings'),
    ),
  },
  {
    name: 'Contest Coordinator',
    description: 'Reads the whole board and handles clarifications, messages and announcements.',
    permissions: compose(ADMIN_LOGIN, PUBLIC_READS, MESSAGING_ACCESS),
  },
];
