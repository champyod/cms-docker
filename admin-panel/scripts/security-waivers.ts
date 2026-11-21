#!/usr/bin/env bun
/**
 * The waiver table's one command-line entry: render it, gate on it, write the suppressions it
 * licenses.
 *
 * WHY this exists at all: `.trivyignore` and `bun audit --ignore GHSA-…` were two hand-kept lists
 * with no owner, no reason and no date. `security_waivers` is the table that replaced them, and
 * this file is the only thing that turns a row into a suppression — so the file a scanner reads is
 * always a rendering of the table, never a list somebody edited.
 *
 * WHY CI never runs `export`: rendering the export needs the panel's database, and CI holds no
 * credential that can reach it. The panel-side command writes `security/waivers.json`; CI only
 * reads that file (check + render), which is the whole least-privilege design in one sentence.
 * See docs/SECURITY-FEED.md §"Suppressions in CI".
 *
 *   bun admin-panel/scripts/security-waivers.ts export [--out <path>]
 *       Read the live waiver rows and write the export. Needs DATABASE_URL (the panel's own).
 *
 *   bun admin-panel/scripts/security-waivers.ts check --from <path>
 *       Exit 1 when any waiver is past its review date, naming every id and date, or when the
 *       export is malformed or older than MAX_EXPORT_AGE_DAYS.
 *
 *   bun admin-panel/scripts/security-waivers.ts render --from <path>
 *       [--trivy <path>] [--audit-ids <path>]
 *       Write the scanner suppressions the live waivers license (and nothing else).
 *
 * Exit codes: 0 ok, 1 the gate refused, 2 the command line was wrong.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  MAX_EXPORT_AGE_DAYS,
  parseWaiverExport,
  renderAuditIgnoreIds,
  renderTrivyIgnore,
  waiverGateFailure,
  type WaiverExport,
} from '@/lib/security/waiver-gate';

const USAGE = `usage: security-waivers.ts <command> [options]

  export [--out <path>]                     render security/waivers.json from the waiver table
  check  --from <path> [--now <iso>]        fail when a waiver is past its review date
  render --from <path> [--trivy <path>] [--audit-ids <path>]
                                            write the scanner suppressions the waivers license`;

/** A command line this file cannot read, as opposed to a gate that refused the export. */
class UsageError extends Error {}

interface Flags {
  readonly values: ReadonlyMap<string, string>;
}

function readFlags(args: readonly string[], allowed: readonly string[]): Flags {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) throw new UsageError(`unexpected argument ${JSON.stringify(token)}`);
    const name = token.slice(2);
    if (!allowed.includes(name)) throw new UsageError(`unknown option ${token}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${token} needs a value`);
    values.set(name, value);
    index += 1;
  }
  return { values };
}

function required(flags: Flags, name: string): string {
  const value = flags.values.get(name);
  if (value === undefined) throw new UsageError(`--${name} is required`);
  return value;
}

/** Reads and validates the export, so every command refuses the same bad file the same way. */
function readExport(path: string): WaiverExport {
  const absolute = resolve(path);
  let raw: string;
  try {
    raw = readFileSync(absolute, 'utf8');
  } catch {
    throw new UsageError(
      `${path} cannot be read — render it with: bun admin-panel/scripts/security-waivers.ts export`,
    );
  }
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    throw new UsageError(`${path} is not valid JSON`);
  }
  const parsed = parseWaiverExport(document);
  if (!parsed.ok) throw new UsageError(`${path}: ${parsed.error}`);
  return parsed.value;
}

function write(path: string, body: string): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
}

/**
 * Renders the export from the panel's own read path.
 *
 * WHY the import is dynamic: `check` and `render` run in a CI job that installs no Prisma client
 * and has no database, and a static import would drag `@prisma/client` into them.
 */
async function exportWaivers(out: string): Promise<void> {
  const { readWaiverExport } = await import('@/lib/security/patching-read');
  const { SYSTEM_IDENTITIES, withActor } = await import('@/lib/db-actor');
  // WHY a named identity: every table is row-level secured on cms.actor, and this process has no
  // request and no cookie. Rendering the export is a read-only operator action on the panel's
  // behalf, so it runs as system:cli — the same identity `./cms panel` uses — instead of
  // borrowing a human admin's id, which would make the audit trail lie about who read the table.
  const rendered = await withActor(
    { kind: 'system', name: SYSTEM_IDENTITIES.CLI },
    () => readWaiverExport(),
  );
  write(out, `${JSON.stringify(rendered, null, 2)}\n`);
  process.stdout.write(
    `wrote ${out}: ${String(rendered.waivers.length)} live waiver(s), rendered ${rendered.generatedAt}\n`,
  );
}

function check(exported: WaiverExport, now: Date): number {
  const failure = waiverGateFailure(exported, now);
  if (failure !== null) {
    process.stderr.write(`waiver gate FAILED — ${failure}\n`);
    return 1;
  }
  const latest = exported.waivers
    .map((waiver) => waiver.reviewBy)
    .sort()
    .at(-1);
  process.stdout.write(
    `waiver gate passed: ${String(exported.waivers.length)} live waiver(s)` +
      `${latest === undefined ? '' : `, the next review is due ${latest.slice(0, 10)}`}` +
      `; export rendered ${exported.generatedAt.slice(0, 10)} (bound ${String(MAX_EXPORT_AGE_DAYS)} days)\n`,
  );
  return 0;
}

function render(exported: WaiverExport, now: Date, trivy: string | undefined, auditIds: string | undefined): number {
  if (trivy === undefined && auditIds === undefined) {
    throw new UsageError('render needs --trivy, --audit-ids, or both');
  }
  if (trivy !== undefined) {
    write(trivy, renderTrivyIgnore(exported.waivers, now));
    process.stdout.write(`wrote ${trivy}\n`);
  }
  if (auditIds !== undefined) {
    const ids = renderAuditIgnoreIds(exported.waivers, now);
    // One id per line, and no trailing blank line: the shell reads this file as a list.
    write(auditIds, ids.length === 0 ? '' : `${ids.join('\n')}\n`);
    process.stdout.write(`wrote ${auditIds}: ${ids.length === 0 ? 'no audit waivers' : ids.join(' ')}\n`);
  }
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return command === undefined ? 2 : 0;
  }
  try {
    if (command === 'export') {
      const flags = readFlags(rest, ['out']);
      await exportWaivers(flags.values.get('out') ?? '../security/waivers.json');
      return 0;
    }
    if (command === 'check') {
      const flags = readFlags(rest, ['from', 'now']);
      const nowText = flags.values.get('now');
      const now = nowText === undefined ? new Date() : new Date(nowText);
      if (Number.isNaN(now.getTime())) throw new UsageError('--now is not a date');
      return check(readExport(required(flags, 'from')), now);
    }
    if (command === 'render') {
      const flags = readFlags(rest, ['from', 'trivy', 'audit-ids']);
      return render(
        readExport(required(flags, 'from')),
        new Date(),
        flags.values.get('trivy'),
        flags.values.get('audit-ids'),
      );
    }
    throw new UsageError(`unknown command ${JSON.stringify(command)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`security-waivers: ${message}\n`);
    if (error instanceof UsageError) process.stderr.write(`${USAGE}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
