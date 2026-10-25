/**
 * The renderer's command-line surface, so the shell control plane and the panel
 * share one implementation instead of two that drift.
 *
 * WHY a payload on stdin and not arguments: the row set is the database's, and a
 * CLI that took rows as flags would put the registry on a command line where it
 * is visible to every process listing. stdin also keeps the caller free of
 * quoting rules.
 */
import { applyRegistryArtifacts } from './service-wiring-apply';
import {
  renderFromPayload,
  type RenderMode,
  type WiringPayload,
} from './service-wiring-artifacts';
import { WiringError, type ExposureRow, type ServiceRow, type WiringRow } from './service-wiring';
import { CONTEST_PROXY_CERTIFICATE, RenderError, type CertificateSpec } from './service-wiring-render';

export { renderFromPayload, renderRegistryArtifacts, type RegistryArtifact, type RenderMode, type WiringPayload } from './service-wiring-artifacts';

const USAGE = 'usage: service-wiring-cli <nginx|serve <node>|location <label>|apply <dir>> [--cert P --key P --ssl-include P] [--front-vhosts L] < payload.json';

/** A payload that is not the shape the renderer consumes is refused, never coerced. */
export function parsePayload(raw: string): WiringPayload {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new WiringError('payload must be a JSON object');
  }
  const candidate = parsed as Partial<WiringPayload>;
  for (const field of ['services', 'wirings', 'exposures'] as const) {
    if (!Array.isArray(candidate[field])) {
      throw new WiringError(`payload field "${field}" must be an array`);
    }
  }
  return {
    services: candidate.services as ServiceRow[],
    wirings: candidate.wirings as WiringRow[],
    exposures: candidate.exposures as ExposureRow[],
  };
}

/**
 * Reads --cert/--key/--ssl-include. WHY flags and not environment: the choice belongs
 * to the caller that knows which front will read the file, and a flag cannot leak into
 * an unrelated process the way an exported variable can.
 */
export function parseCertificate(argv: readonly string[]): CertificateSpec {
  const spec: CertificateSpec = { ...CONTEST_PROXY_CERTIFICATE };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--cert' && value !== undefined) spec.certificate = value;
    else if (flag === '--key' && value !== undefined) spec.key = value;
    else if (flag === '--ssl-include' && value !== undefined) spec.sslInclude = value;
  }
  return spec;
}

/** Reads the comma-separated --front-vhosts list: each entry `label|hostname|paths|keys` or a bare hostname. */
export function parseFrontVhosts(argv: readonly string[]): string[] {
  const index = argv.indexOf('--front-vhosts');
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined) return [];
  return value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Reported on stderr with a non-zero exit so a shell caller can fail the sync. */
function fail(message: string): never {
  process.stderr.write(`service-wiring-cli: ${message}\n`);
  process.exit(2);
}

const APPLY_MODE = 'apply';

function isRenderMode(value: string | undefined): value is RenderMode {
  return value === 'nginx' || value === 'serve' || value === 'location';
}

/**
 * `apply <dir>` is the sync's own path: it writes the whole artifact set and answers with what it
 * changed, so the shell no longer names files or assembles any part of the config itself.
 */
async function main(): Promise<void> {
  const mode = process.argv[2];
  const argv = process.argv.slice(2);
  if (!isRenderMode(mode) && mode !== APPLY_MODE) fail(USAGE);
  const certificate = parseCertificate(argv);
  const name = mode === 'nginx' || mode === APPLY_MODE ? undefined : process.argv[3];
  const raw = await readStdin();
  try {
    const payload = parsePayload(raw);
    const report = mode === APPLY_MODE
      ? await applyToDirectory(payload, argv, certificate)
      : renderFromPayload(payload, mode, certificate, name, parseFrontVhosts(argv));
    process.stdout.write(typeof report === 'string' ? report : JSON.stringify(report));
  } catch (error) {
    if (error instanceof WiringError || error instanceof RenderError) fail(error.message);
    fail(error instanceof Error ? error.message : String(error));
  }
}

/** Writes the artifact set into the directory the caller names, answering the changed-file report. */
async function applyToDirectory(
  payload: WiringPayload,
  argv: readonly string[],
  certificate: CertificateSpec
): Promise<Awaited<ReturnType<typeof applyRegistryArtifacts>>> {
  const outDir = argv[1];
  if (outDir === undefined) fail(USAGE);
  return applyRegistryArtifacts(payload, { outDir, frontVhosts: parseFrontVhosts(argv), certificate });
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith('service-wiring-cli.ts');
if (invokedDirectly) void main();
