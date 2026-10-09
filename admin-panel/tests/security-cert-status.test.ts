import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { EXPIRY_WARNING_DAYS, describeLineage } from '@/lib/security/cert-status';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LINEAGE_DIR = path.join(REPO_ROOT, 'config/letsencrypt/live');

function readLineagePem(lineage: string): string {
  return fs.readFileSync(path.join(LINEAGE_DIR, lineage, 'fullchain.pem'), 'utf-8');
}

describe('describeLineage', () => {
  it('reads a certificate this deployment ships', () => {
    const status = describeLineage('admin.cms.local', readLineagePem('admin.cms.local'));

    expect(status).not.toBeNull();
    expect(status?.lineage).toBe('admin.cms.local');
    expect(Date.parse(status?.validTo ?? '')).not.toBeNaN();
    expect(typeof status?.daysRemaining).toBe('number');
    expect(status?.subject).toContain('CN=');
  });

  it('flags a certificate that is already inside the warning window', () => {
    const status = describeLineage('admin.cms.local', readLineagePem('admin.cms.local'), new Date('2999-01-01T00:00:00Z'));

    expect(status?.expiresSoon).toBe(true);
    expect(status?.daysRemaining).toBeLessThan(0);
  });

  it('reports an unreadable certificate as null instead of inventing one', () => {
    expect(describeLineage('broken', 'not a certificate')).toBeNull();
    expect(EXPIRY_WARNING_DAYS).toBeGreaterThan(0);
  });
});
