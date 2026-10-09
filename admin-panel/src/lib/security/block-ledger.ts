import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';

export const BLOCK_KINDS = ['waf', 'fail2ban', 'login_lockout'] as const;
export const BLOCK_SOURCES = ['app', 'agent'] as const;

export const DEFAULT_BLOCK_LIMIT = 200;

export type BlockKind = (typeof BLOCK_KINDS)[number];
export type BlockSource = (typeof BLOCK_SOURCES)[number];

export interface SecurityBlock {
  readonly id: string;
  readonly kind: BlockKind;
  readonly source: BlockSource;
  readonly ip: string | null;
  readonly subject: string | null;
  readonly detail: unknown;
  readonly startedAt: Date;
  readonly expiresAt: Date | null;
  readonly active: boolean;
}

export interface BlockEventInput {
  readonly kind: BlockKind;
  readonly source: BlockSource;
  readonly ip?: string | null;
  readonly subject?: string | null;
  readonly detail?: Prisma.InputJsonValue;
  readonly startedAt?: Date;
  readonly expiresAt?: Date | null;
}

export interface BlockIdentity {
  readonly kind: BlockKind;
  readonly ip?: string | null;
  readonly subject?: string | null;
}

export interface BlockQuery {
  readonly kind?: BlockKind;
  readonly active?: boolean;
  readonly limit?: number;
}

interface SecurityBlockRow {
  readonly id: bigint;
  readonly kind: string;
  readonly source: string;
  readonly ip: string | null;
  readonly subject: string | null;
  readonly detail: Prisma.JsonValue | null;
  readonly started_at: Date;
  readonly expires_at: Date | null;
  readonly active: boolean;
}

export function isBlockKind(value: string): value is BlockKind {
  return BLOCK_KINDS.some((kind) => kind === value);
}

export function isBlockSource(value: string): value is BlockSource {
  return BLOCK_SOURCES.some((source) => source === value);
}

function requireBlockKind(value: string): BlockKind {
  if (isBlockKind(value)) return value;
  throw new Error(`Unknown security block kind: ${value}`);
}

function requireBlockSource(value: string): BlockSource {
  if (isBlockSource(value)) return value;
  throw new Error(`Unknown security block source: ${value}`);
}

function toSecurityBlock(row: SecurityBlockRow): SecurityBlock {
  return {
    id: row.id.toString(),
    kind: requireBlockKind(row.kind),
    source: requireBlockSource(row.source),
    ip: row.ip,
    subject: row.subject,
    detail: row.detail,
    startedAt: row.started_at,
    expiresAt: row.expires_at,
    active: row.active,
  };
}

function parseBlockId(id: string): bigint | null {
  return /^\d+$/.test(id) ? BigInt(id) : null;
}

function identityWhere(identity: BlockIdentity): Prisma.security_blocksWhereInput {
  return { kind: identity.kind, ip: identity.ip ?? null, subject: identity.subject ?? null, active: true };
}

/**
 * Records one block event and closes any still-active row with the same identity,
 * so a repeated sync cannot leave two active rows for one banned address.
 */
export async function recordBlock(input: BlockEventInput): Promise<SecurityBlock> {
  const startedAt = input.startedAt ?? new Date();
  const row = await prisma.$transaction(async (tx) => {
    await tx.security_blocks.updateMany({
      where: identityWhere(input),
      data: { active: false, ended_at: startedAt },
    });
    return tx.security_blocks.create({
      data: {
        kind: input.kind,
        source: input.source,
        ip: input.ip ?? null,
        subject: input.subject ?? null,
        detail: input.detail,
        started_at: startedAt,
        expires_at: input.expiresAt ?? null,
      },
    });
  });
  return toSecurityBlock(row);
}

/** Closes one block by id; null means the id is unparsable or the row was already closed. */
export async function endBlock(id: string, adminId: number, now: Date = new Date()): Promise<SecurityBlock | null> {
  const blockId = parseBlockId(id);
  if (blockId === null) return null;
  const closed = await prisma.security_blocks.updateMany({
    where: { id: blockId, active: true },
    data: { active: false, ended_at: now, ended_by: adminId },
  });
  if (closed.count === 0) return null;
  const row = await prisma.security_blocks.findUnique({ where: { id: blockId } });
  return row === null ? null : toSecurityBlock(row);
}

/** Closes every active block matching an identity; returns how many rows were closed. */
export async function endActiveBlocks(identity: BlockIdentity, adminId: number, now: Date = new Date()): Promise<number> {
  const closed = await prisma.security_blocks.updateMany({
    where: identityWhere(identity),
    data: { active: false, ended_at: now, ended_by: adminId },
  });
  return closed.count;
}

export async function listBlocks(query: BlockQuery = {}): Promise<SecurityBlock[]> {
  const rows = await prisma.security_blocks.findMany({
    where: {
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      ...(query.active === undefined ? {} : { active: query.active }),
    },
    orderBy: { started_at: 'desc' },
    take: query.limit ?? DEFAULT_BLOCK_LIMIT,
  });
  return rows.map(toSecurityBlock);
}

/** A ban whose expiry has passed stops being active even if nothing reported its end. */
export async function expireStaleBlocks(now: Date = new Date()): Promise<number> {
  const expired = await prisma.security_blocks.updateMany({
    where: { active: true, expires_at: { not: null, lte: now } },
    data: { active: false, ended_at: now },
  });
  return expired.count;
}

export async function countActiveByKind(): Promise<Readonly<Record<BlockKind, number>>> {
  const rows = await prisma.security_blocks.groupBy({
    by: ['kind'],
    where: { active: true },
    _count: { _all: true },
  });
  const counts: Record<BlockKind, number> = { waf: 0, fail2ban: 0, login_lockout: 0 };
  for (const row of rows) {
    if (isBlockKind(row.kind)) counts[row.kind] = row._count._all;
  }
  return counts;
}
