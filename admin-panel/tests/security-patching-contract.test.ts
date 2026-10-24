import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_GROUPS } from '@/lib/permission-groups';
import { PERMISSION_REGISTRY } from '@/lib/permission-registry';
import { isRoutePermitted } from '@/lib/navigation/permissions';
import { SECURITY_ROUTES } from '@/lib/navigation/registry-security';
import type { RouteDescriptor } from '@/lib/navigation/types';

const PANEL = join(__dirname, '..');
const SRC = join(PANEL, 'src');

function read(relativePath: string): string {
  return readFileSync(join(PANEL, relativePath), 'utf8');
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

function modelBody(schema: string, model: string): string {
  const match = schema.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, 'm'));
  if (match === null) throw new Error(`model ${model} is missing from schema.prisma`);
  return match[1];
}

function fieldLine(body: string, field: string): string {
  const line = body.split('\n').find((entry) => new RegExp(`^\\s+${field}\\s+\\S`).test(entry));
  if (line === undefined) throw new Error(`field ${field} is missing`);
  return line.trim().replace(/\s+/g, ' ');
}

const SCHEMA = read('prisma/schema.prisma');
const MIGRATION = read('prisma/migrations/20261024120000_security_findings/migration.sql');

describe('security feed schema contract', () => {
  it('declares security_findings exactly as the contract specifies', () => {
    const body = modelBody(SCHEMA, 'security_findings');
    expect(fieldLine(body, 'id')).toBe('id Int @id @default(autoincrement())');
    expect(fieldLine(body, 'source')).toBe('source String @db.VarChar');
    expect(fieldLine(body, 'key')).toBe('key String @db.VarChar');
    expect(fieldLine(body, 'kind')).toBe('kind String @db.VarChar');
    expect(fieldLine(body, 'severity')).toBe('severity String? @db.VarChar');
    expect(fieldLine(body, 'subject')).toBe('subject String @db.VarChar');
    expect(fieldLine(body, 'installed')).toBe('installed String? @db.VarChar');
    expect(fieldLine(body, 'available')).toBe('available String? @db.VarChar');
    expect(fieldLine(body, 'title')).toBe('title String? @db.VarChar');
    expect(fieldLine(body, 'url')).toBe('url String? @db.VarChar');
    expect(fieldLine(body, 'host')).toBe('host String? @db.VarChar');
    expect(fieldLine(body, 'detail')).toBe('detail Json?');
    expect(fieldLine(body, 'first_seen')).toBe('first_seen DateTime @default(now())');
    expect(fieldLine(body, 'last_seen')).toBe('last_seen DateTime @updatedAt');
    expect(fieldLine(body, 'resolved_at')).toBe('resolved_at DateTime?');
    expect(body).toContain('@@unique([source, key])');
    expect(body).toContain('@@index([resolved_at, severity])');
  });

  it('declares security_waivers with a mandatory review date and no delete', () => {
    const body = modelBody(SCHEMA, 'security_waivers');
    expect(fieldLine(body, 'source')).toBe('source String @db.VarChar');
    expect(fieldLine(body, 'match')).toBe('match String @db.VarChar');
    expect(fieldLine(body, 'reason')).toBe('reason String');
    expect(fieldLine(body, 'review_by')).toBe('review_by DateTime');
    expect(fieldLine(body, 'created_by')).toBe('created_by Int');
    expect(fieldLine(body, 'created_at')).toBe('created_at DateTime @default(now())');
    expect(fieldLine(body, 'ended_at')).toBe('ended_at DateTime?');
  });

  it('refuses a waiver row without a review date, a reason or an author at the storage layer', () => {
    // WHY the migration text and not only the model: the model is what a caller sees, and the
    // NOT NULLs in the generated DDL are what a hand-written INSERT (a psql session, a script)
    // actually hits. Verified against a real Postgres: an INSERT that omits review_by fails with
    // 'null value in column "review_by" … violates not-null constraint'.
    expect(MIGRATION).toContain('"match" VARCHAR NOT NULL');
    expect(MIGRATION).toContain('"reason" TEXT NOT NULL');
    expect(MIGRATION).toContain('"review_by" TIMESTAMP(3) NOT NULL');
    expect(MIGRATION).toContain('"created_by" INTEGER NOT NULL');
    // A nullable review date would let the table hold the thing this lane removed.
    const reviewLine = MIGRATION.split('\n').find((line) => line.includes('"review_by"')) ?? '';
    expect(reviewLine).toContain('NOT NULL');
  });

  it('ships one generated migration that creates both tables and their RLS guards', () => {
    expect(MIGRATION).toContain('-- GENERATED — do not hand-edit the statements below.');
    expect(MIGRATION).toContain('CREATE TABLE "security_findings"');
    expect(MIGRATION).toContain('CREATE TABLE "security_waivers"');
    expect(MIGRATION).toContain('CREATE UNIQUE INDEX "security_findings_source_key_key"');
    expect(MIGRATION).toContain('CREATE INDEX "security_findings_resolved_at_severity_idx"');
    expect(MIGRATION).toContain("ENABLE ROW LEVEL SECURITY';\n    EXECUTE 'ALTER TABLE public.security_findings FORCE ROW LEVEL SECURITY'");
    expect(MIGRATION).toContain("ENABLE ROW LEVEL SECURITY';\n    EXECUTE 'ALTER TABLE public.security_waivers FORCE ROW LEVEL SECURITY'");
  });
});

describe('security.patching permission gate', () => {
  const descriptor = SECURITY_ROUTES.find((route) => route.id === 'security.patching') as
    | RouteDescriptor
    | undefined;

  it('is registered as an enabled security field gated on security:read + patching:read', () => {
    expect(descriptor).toBeDefined();
    expect(descriptor?.enabled).toBe(true);
    expect(descriptor?.path).toBe('/security/patching');
    expect(descriptor?.permission).toEqual({ all: ['security:read', 'patching:read'] });
  });

  it('denies without patching:read and without security:read', () => {
    if (descriptor === undefined) throw new Error('missing descriptor');
    expect(isRoutePermitted(descriptor, new Set(['security:read', 'patching:read']))).toBe(true);
    expect(isRoutePermitted(descriptor, new Set(['security:read']))).toBe(false);
    expect(isRoutePermitted(descriptor, new Set(['patching:read']))).toBe(false);
  });

  it('seeds both keys and grants them to the Security group', () => {
    const keys = new Set(PERMISSION_REGISTRY.map((definition) => definition.key));
    expect(keys.has('patching:read')).toBe(true);
    expect(keys.has('patching:waive')).toBe(true);
    const security = DEFAULT_GROUPS.find((group) => group.name === 'Security');
    expect(security?.permissions).toContain('patching:read');
    expect(security?.permissions).toContain('patching:waive');
  });
});

describe('one read path', () => {
  it('is the only module querying the two tables', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      if (file.endsWith('patching-read.ts')) return false;
      const source = readFileSync(file, 'utf8');
      return /security_findings\.(findMany|findFirst|findUnique|count)|security_waivers\.(findMany|findFirst|findUnique|count)/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('feeds both the page and the overview cards from the actions module', () => {
    const page = read('src/app/[locale]/(authenticated)/security/patching/page.tsx');
    const overview = read('src/app/[locale]/(authenticated)/security/overview/page.tsx');
    for (const source of [page, overview]) {
      expect(source).toContain("from '@/app/actions/securityPatching'");
      expect(source).toContain('readPatchingState(');
      expect(source).not.toContain('patching-read');
      expect(source).not.toContain('prisma.');
    }
    const actions = read('src/app/actions/securityPatching.ts');
    expect(actions).toContain("from '@/lib/security/patching-read'");
    expect(actions).toContain('readPatchingSnapshot(');
  });
});
