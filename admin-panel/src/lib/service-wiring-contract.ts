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

export interface ServiceInput {
  name: string;
  role: ServiceRole;
  shard: number;
  host: string;
  http_port: number | null;
  rpc_port: number | null;
  db_profile: string;
  contest_id: number | null;
  enabled: boolean;
}

export interface WiringInput {
  from_service_id: number;
  to_service_id: number;
  relation: string;
  enabled: boolean;
}

export interface ExposureInput {
  contest_id: number;
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
}

export interface WiringRecord {
  id: number;
  from_service_id: number;
  to_service_id: number;
  relation: string;
  enabled: boolean;
}

export interface ExposureRecord {
  id: number;
  contest_id: number;
  hostname: string;
  path: string;
  tls: boolean;
  tailnet: string | null;
}
