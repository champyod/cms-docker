/**
 * Writes the rendered artifact set into one directory, and says which files it touched.
 *
 * WHY a directory writer instead of the shell naming files: the sync, the panel's apply and the
 * reconciler must produce the same bytes from the same rows, so exactly one place decides each file's
 * name, its content and its trailing newline.
 */
import fs from 'fs/promises';
import path from 'path';

import { renderRegistryArtifacts, type RegistryArtifact, type WiringPayload } from './service-wiring-artifacts';
import { CONTEST_PROXY_CERTIFICATE, type CertificateSpec } from './service-wiring-render';

const ROUTES_FILE = 'contest-routes.conf';
const FRAGMENT_PREFIX = 'locations-';
const CONFIG_EXTENSION = '.conf';
const SERVE_DIR = 'tailscale';
const SERVE_EXTENSION = '.json';

export type ArtifactStatus = 'added' | 'changed' | 'unchanged' | 'removed';

export interface ArtifactWrite {
  /** The file, relative to the directory the caller named. */
  readonly path: string;
  readonly status: ArtifactStatus;
}

export interface ApplyOptions {
  readonly outDir: string;
  readonly frontVhosts?: readonly string[];
  readonly certificate?: CertificateSpec;
}

/** Where one artifact lives, relative to the output directory. */
function artifactPath(artifact: RegistryArtifact): string {
  if (artifact.mode === 'nginx') return ROUTES_FILE;
  if (artifact.mode === 'location') return `${FRAGMENT_PREFIX}${artifact.node ?? ''}${CONFIG_EXTENSION}`;
  return `${SERVE_DIR}/${artifact.node ?? ''}${SERVE_EXTENSION}`;
}

/** The exact bytes the artifact becomes. WHY the newline: the sync's fragments were written with one. */
function artifactBody(artifact: RegistryArtifact): string {
  return artifact.mode === 'location' ? `${artifact.content}\n` : artifact.content;
}

async function readExisting(file: string): Promise<string | null> {
  return fs.readFile(file, 'utf8').catch(() => null);
}

/** Writes one file only when its bytes differ, so an unchanged tree is never rewritten. */
async function writeWhenChanged(outDir: string, relative: string, body: string): Promise<ArtifactStatus> {
  const file = path.join(outDir, relative);
  const existing = await readExisting(file);
  if (existing === body) return 'unchanged';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return existing === null ? 'added' : 'changed';
}

/** Serve configs whose node the registry no longer names, so a removed tunnel keeps no file. */
async function removeStaleServeConfigs(outDir: string, keep: ReadonlySet<string>): Promise<ArtifactWrite[]> {
  const dir = path.join(outDir, SERVE_DIR);
  const entries = await fs.readdir(dir).catch(() => []);
  const removed: ArtifactWrite[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(SERVE_EXTENSION)) continue;
    const node = entry.slice(0, -SERVE_EXTENSION.length);
    if (keep.has(node)) continue;
    await fs.rm(path.join(dir, entry), { force: true });
    removed.push({ path: `${SERVE_DIR}/${entry}`, status: 'removed' });
  }
  return removed;
}

/**
 * Renders the whole set before writing anything, so a refused registry leaves the directory as it
 * was instead of half-applied.
 */
export async function applyRegistryArtifacts(payload: WiringPayload, options: ApplyOptions): Promise<ArtifactWrite[]> {
  const artifacts = renderRegistryArtifacts(
    payload,
    options.frontVhosts ?? [],
    options.certificate ?? CONTEST_PROXY_CERTIFICATE,
  );
  const writes: ArtifactWrite[] = [];
  const keep = new Set<string>();
  for (const artifact of artifacts) {
    if (artifact.mode === 'serve' && artifact.node !== null) keep.add(artifact.node);
    writes.push({
      path: artifactPath(artifact),
      status: await writeWhenChanged(options.outDir, artifactPath(artifact), artifactBody(artifact)),
    });
  }
  return [...writes, ...(await removeStaleServeConfigs(options.outDir, keep))];
}
