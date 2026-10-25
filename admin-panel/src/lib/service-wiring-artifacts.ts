/**
 * Every artifact the next config sync would write, rendered in-process from the registry payload.
 *
 * WHY its own module: the CLI, the panel's preview and the file writer all need this one list, and a
 * module that imported the CLI to reach it would make the CLI's own entry point a dependency of the
 * code it is meant to call.
 */
import { exposureRoutes, resolveWirings, WiringError, type ExposureRow, type ServiceRow, type WiringRow } from './service-wiring';
import { parseFrontVhostList } from './service-wiring-front-vhosts';
import { assertSafeTailnetNode, CONTEST_PROXY_CERTIFICATE, renderLocationFragments, renderNginxServers, renderServeConfigs, type CertificateSpec } from './service-wiring-render';

export interface WiringPayload {
  services: ServiceRow[];
  wirings: WiringRow[];
  exposures: ExposureRow[];
}

/** WHICH artifact a run renders, and the file its mode names. */
export type RenderMode = 'nginx' | 'serve' | 'location';

/** One artifact the next config sync would write, named the way its mode names its files. */
export interface RegistryArtifact {
  readonly mode: RenderMode;
  /** The tailnet node a serve config belongs to, or the front vhost label a fragment is named for. */
  readonly node: string | null;
  readonly content: string;
}

/**
 * Validates the whole registry, then renders one artifact. WHY validation runs
 * even for a render that ignores wirings: a wiring naming a service the registry
 * lost is a broken deployment, and reporting it here beats serving confidence
 * from a half-known registry.
 *
 * WHY `name` carries both a node and a label: each render mode names the file it writes, and the
 * two are never both needed — a serve config belongs to one tailnet node, a fragment to one front
 * vhost — so one parameter keeps a caller from passing an argument the mode ignores.
 */
export function renderFromPayload(
  payload: WiringPayload,
  mode: RenderMode,
  certificate: CertificateSpec = CONTEST_PROXY_CERTIFICATE,
  name?: string,
  frontVhosts: readonly string[] = []
): string {
  resolveWirings(payload.services, payload.wirings);
  const routes = exposureRoutes(payload.exposures, payload.services, frontVhosts);
  if (mode === 'nginx') return renderNginxServers(routes, certificate);
  if (mode === 'location') {
    if (name === undefined) {
      throw new WiringError('location mode needs the front vhost label whose fragment it renders');
    }
    return renderLocationFragments(routes, name);
  }
  if (name === undefined) {
    throw new WiringError('serve mode needs a tailnet node, because each node serves its own contests');
  }
  // Rendering every node and selecting one keeps the node-name validation on this path.
  return renderServeConfigs(routes).get(assertSafeTailnetNode(name)) ?? '';
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
 *
 * WHY one artifact per front vhost: the sync writes each fragment to its own file, and a vhost
 * includes only its own label's — so a preview that folded them into one would hide which file an
 * exposure under the front's own name lands in. WHY a vhost with nothing to render is dropped: the
 * sync writes no file for it, so listing one would report an artifact the next sync never produces.
 */
export function renderRegistryArtifacts(
  payload: WiringPayload,
  frontVhosts: readonly string[] = [],
  certificate: CertificateSpec = CONTEST_PROXY_CERTIFICATE
): RegistryArtifact[] {
  const artifacts: RegistryArtifact[] = [
    { mode: 'nginx', node: null, content: renderFromPayload(payload, 'nginx', certificate, undefined, frontVhosts) },
  ];
  for (const vhost of parseFrontVhostList(frontVhosts)) {
    if (vhost.label === null) continue;
    const content = renderFromPayload(payload, 'location', certificate, vhost.label, frontVhosts);
    if (content === '') continue;
    artifacts.push({ mode: 'location', node: vhost.label, content });
  }
  for (const node of tailnetNodes(payload)) {
    artifacts.push({
      mode: 'serve',
      node,
      content: renderFromPayload(payload, 'serve', certificate, node, frontVhosts),
    });
  }
  return artifacts;
}
