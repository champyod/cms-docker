/**
 * The renderer's command-line surface, so the shell control plane and the panel
 * share one implementation instead of two that drift.
 *
 * WHY a payload on stdin and not arguments: the row set is the database's, and a
 * CLI that took rows as flags would put the registry on a command line where it
 * is visible to every process listing. stdin also keeps the caller free of
 * quoting rules.
 */
import {
  exposureRoutes,
  resolveWirings,
  WiringError,
  type ExposureRow,
  type ServiceRow,
  type WiringRow,
} from './service-wiring';
import {
  assertSafeTailnetNode,
  CONTEST_PROXY_CERTIFICATE,
  RenderError,
  renderNginxServers,
  renderServeConfigs,
  type CertificateSpec,
} from './service-wiring-render';

export interface WiringPayload {
  services: ServiceRow[];
  wirings: WiringRow[];
  exposures: ExposureRow[];
}

export type RenderMode = 'nginx' | 'serve';

const USAGE = 'usage: service-wiring-cli <nginx|serve <node>> [--cert P --key P --ssl-include P] < payload.json';

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
 * Validates the whole registry, then renders one artifact. WHY validation runs
 * even for a render that ignores wirings: a wiring naming a service the registry
 * lost is a broken deployment, and reporting it here beats serving confidence
 * from a half-known registry.
 */
export function renderFromPayload(
  payload: WiringPayload,
  mode: RenderMode,
  certificate: CertificateSpec = CONTEST_PROXY_CERTIFICATE,
  node?: string
): string {
  resolveWirings(payload.services, payload.wirings);
  const routes = exposureRoutes(payload.exposures, payload.services);
  if (mode === 'nginx') return renderNginxServers(routes, certificate);
  if (node === undefined) {
    throw new WiringError('serve mode needs a tailnet node, because each node serves its own contests');
  }
  // Rendering every node and selecting one keeps the node-name validation on this path.
  return renderServeConfigs(routes).get(assertSafeTailnetNode(node)) ?? '';
}

/** One artifact the next config sync would write, with the node a serve config belongs to. */
export interface RegistryArtifact {
  readonly mode: RenderMode;
  readonly node: string | null;
  readonly content: string;
}

/** The tailnet nodes the exposures claim, canonicalised and deduplicated so each renders once. */
function tailnetNodes(payload: WiringPayload): string[] {
  const nodes = new Set<string>();
  for (const exposure of payload.exposures) {
    if (exposure.tailnet === null || exposure.tailnet.trim() === '') continue;
    nodes.add(assertSafeTailnetNode(exposure.tailnet));
  }
  return [...nodes];
}

/**
 * Renders every artifact the next config sync would write, in-process.
 *
 * WHY the panel imports this instead of shelling out to the CLI: the CLI exists so the
 * shell control plane and the panel share one renderer, and a preview that spawned it
 * would add a process and a stdin round trip for output the panel can compute directly.
 */
export function renderRegistryArtifacts(payload: WiringPayload): RegistryArtifact[] {
  const artifacts: RegistryArtifact[] = [
    { mode: 'nginx', node: null, content: renderFromPayload(payload, 'nginx') },
  ];
  for (const node of tailnetNodes(payload)) {
    artifacts.push({
      mode: 'serve',
      node,
      content: renderFromPayload(payload, 'serve', CONTEST_PROXY_CERTIFICATE, node),
    });
  }
  return artifacts;
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

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== 'nginx' && mode !== 'serve') fail(USAGE);
  const certificate = parseCertificate(process.argv.slice(2));
  const node = mode === 'serve' ? process.argv[3] : undefined;
  const raw = await readStdin();
  try {
    process.stdout.write(renderFromPayload(parsePayload(raw), mode, certificate, node));
  } catch (error) {
    if (error instanceof WiringError || error instanceof RenderError) fail(error.message);
    fail(error instanceof Error ? error.message : String(error));
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1].endsWith('service-wiring-cli.ts');
if (invokedDirectly) void main();
