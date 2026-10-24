import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseWaiverExport, waiverGateFailure } from '@/lib/security/waiver-gate';

/**
 * The waiver table is the only place a security suppression may live.
 *
 * WHY these assertions exist as a test and not only as a review habit: P5 was two hand-kept lists
 * (`.trivyignore` and a `bun audit --ignore` flag in the workflow) that nothing re-read. A test
 * that fails when either comes back is what stops the next one from being added beside the table
 * "just for now" — the temptation the whole lane exists to remove.
 */
const PANEL = join(__dirname, '..');
const REPO = join(PANEL, '..');
const EXPORT = join(REPO, 'security', 'waivers.json');
const WORKFLOW = join(REPO, '.github', 'workflows', 'ci.yml');

const EXPORTED = parseWaiverExport(JSON.parse(readFileSync(EXPORT, 'utf8')));

describe('the suppressions CI reads come from the waiver table', () => {
  it('has no hand-kept .trivyignore in the tree', () => {
    expect(existsSync(join(REPO, '.trivyignore'))).toBe(false);
    expect(existsSync(join(PANEL, '.trivyignore'))).toBe(false);
  });

  it('feeds the Trivy step and the audit from the rendered waivers, not from a flag', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');

    // The ignore file is still named `.trivyignore` — Trivy's own default — but it is written per
    // run by the waiver renderer, so nothing in the tree can carry an id.
    expect(workflow).toContain('__security_waivers.sh render');
    expect(workflow).toContain('__security_waivers.sh check');
    expect(workflow).not.toMatch(/bun audit[^\n]*--ignore/);
    expect(workflow).not.toMatch(/--ignore\s+GHSA-/);
  });

  it('keeps every waiver from the retired lists, as a row with a reason, an owner and a date', () => {
    expect(EXPORTED.ok).toBe(true);
    if (!EXPORTED.ok) return;

    // WHY the ids are named: deleting a waiver is how a failing build gets "fixed" without a
    // decision, so the four suppressions that existed as ignore lines have to be present as rows.
    const matches = EXPORTED.value.waivers.map((waiver) => waiver.match).sort();
    expect(matches).toEqual([
      'CVE-2026-78667',
      'CVE-2026-78669',
      'CVE-2026-97031',
      'GHSA-vfj7-8cjw-p6xm',
    ]);
    for (const waiver of EXPORTED.value.waivers) {
      expect(waiver.reason.length).toBeGreaterThan(20);
      expect(waiver.createdByName).not.toBeNull();
      expect(new Date(waiver.reviewBy).getTime()).toBeGreaterThan(0);
    }
  });

  it('passes the gate the build runs, on the file as committed', () => {
    if (!EXPORTED.ok) throw new Error(EXPORTED.error);
    // This is deliberately time-dependent: a waiver that outlives its review date must fail here
    // exactly as it fails CI, rather than wait for a scan or a reader to notice.
    expect(waiverGateFailure(EXPORTED.value, new Date())).toBeNull();
  });
});
