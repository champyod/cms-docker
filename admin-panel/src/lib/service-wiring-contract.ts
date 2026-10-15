/**
 * The registry's shape, shared by the server store and the screen that edits it.
 *
 * WHY this is its own module: the store imports Prisma, so a client component that
 * reached into it for a type or a constant would drag a server-only module into the
 * browser bundle. Types and the role list live here; Prisma stays in the store.
 */

export const SERVICE_ROLES = [
  'ContestWebServer',
  'EvaluationService',
  'ProxyService',
  'Worker',
  'Checker',
  'ScoringService',
  'ResourceService',
  'LogService',
] as const;

export type ServiceRole = (typeof SERVICE_ROLES)[number];

/** The one relay that serves a single contest, so a row of it must name that contest. */
export const PROXY_SERVICE_ROLE = 'ProxyService';

/**
 * The role the contest web server holds: the row a running instance's contest binding
 * resolves against (see contest-binding). Typed as a listed role, so a renamed entry in
 * SERVICE_ROLES fails to compile here instead of reading as a registry with no such row.
 */
export const CONTEST_WEB_SERVER_ROLE: ServiceRole = 'ContestWebServer';

/** The pull policies compose accepts for a service row. */
export const PULL_POLICIES = ['always', 'missing', 'never'] as const;

export type PullPolicy = (typeof PULL_POLICIES)[number];

export interface ServiceInput {
  id?: number;
  name: string;
  role: ServiceRole;
  shard: number;
  host: string;
  http_port: number | null;
  rpc_port: number | null;
  db_profile: string;
  contest_id: number | null;
  enabled: boolean;
  image: string;
  pull_policy: string;
}

export interface WiringInput {
  id?: number;
  from_service_id: number;
  to_service_id: number;
  relation: string;
  enabled: boolean;
}

export interface ExposureInput {
  id?: number;
  service_id: number;
  hostname: string;
  path: string;
  tls: boolean;
  tailnet: string | null;
}

export interface WriteResult {
  success: boolean;
  error?: string;
}

/**
 * What a read returns. WHY the role is a plain string here and a union on write: the
 * table is the authority and may hold a role this build no longer offers, and a screen
 * that refused to render such a row would hide the very entry an operator must edit.
 * The id rides along because removing a row is the screen's other job.
 */
export interface ServiceRecord {
  id: number;
  name: string;
  role: string;
  shard: number;
  host: string;
  http_port: number | null;
  rpc_port: number | null;
  db_profile: string;
  contest_id: number | null;
  enabled: boolean;
  image: string;
  pull_policy: string;
}

export interface WiringRecord {
  id: number;
  from_service_id: number;
  to_service_id: number;
  relation: string;
  enabled: boolean;
}

/**
 * One registry row that binds a service to the contest its shard serves.
 *
 * WHY the panel shows these rows instead of contests.is_active: that flag is a single value, so it
 * cannot say that one shard serves contest 9 while another serves 7, whereas a services row names
 * the contest its own instance serves and cms.db.contest_binding reads that row per call. The shard
 * and the role ride beside the contest because the operator reads the binding per shard, not as
 * one id.
 */
export interface ShardContestBinding {
  id: number;
  name: string;
  role: string;
  shard: number;
  contestId: number;
}

export interface ExposureRecord {
  id: number;
  service_id: number;
  hostname: string;
  path: string;
  tls: boolean;
  tailnet: string | null;
}
