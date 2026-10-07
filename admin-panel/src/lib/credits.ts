import creditsData from '@/lib/credits.json';

/**
 * The committed copy of the repository credits file, which the panel cannot read
 * from its build context, so it is generated into `src/lib/credits.json` and held
 * in step with the source by a drift test. Every field is read through a guard
 * rather than trusted from the JSON import, because a malformed copy would
 * otherwise render a licence notice that silently omits a dependency.
 */
export interface CreditsAsset {
  readonly name: string;
  readonly holder: string;
  /** Absent on assets that ship no pinned version, so the field is not assumed. */
  readonly version: string | null;
  readonly licenseId: string;
  readonly licenseUrls: readonly string[];
  readonly paths: readonly string[];
}

export interface CreditsAttribution {
  readonly text: string;
  readonly url: string;
}

export interface PanelSurfaceCredits {
  readonly title: string;
  readonly attribution: readonly CreditsAttribution[];
  readonly firstParty: readonly string[];
  readonly transitiveDependencies: string | null;
  readonly assets: readonly CreditsAsset[];
}

export interface ProjectLicense {
  readonly spdxId: string;
  readonly name: string;
  readonly url: string;
}

export interface ProjectUpstream {
  readonly name: string;
  readonly url: string;
}

export interface PanelCreditsPage {
  readonly projectName: string;
  readonly sourceUrl: string;
  readonly upstream: ProjectUpstream;
  readonly license: ProjectLicense;
  readonly panel: PanelSurfaceCredits;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`credits.json ${context}: expected an object`);
  }
  return value;
}

function requiredString(source: Record<string, unknown>, key: string, context: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`credits.json ${context}.${key}: expected a non-empty string`);
  }
  return value;
}

function optionalString(source: Record<string, unknown>, key: string, context: string): string | null {
  if (!(key in source)) return null;
  return requiredString(source, key, context);
}

function requiredStringList(
  source: Record<string, unknown>,
  key: string,
  context: string,
): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value)) {
    throw new Error(`credits.json ${context}.${key}: expected an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new Error(`credits.json ${context}.${key}[${index}]: expected a non-empty string`);
    }
    return entry;
  });
}

function parseLink(value: unknown, context: string): CreditsAttribution {
  const link = asRecord(value, context);
  return {
    text: requiredString(link, 'text', context),
    url: requiredString(link, 'url', context),
  };
}

function parseAsset(value: unknown, index: number): CreditsAsset {
  const context = `surfaces.panel.assets[${index}]`;
  const asset = asRecord(value, context);
  return {
    name: requiredString(asset, 'name', context),
    holder: requiredString(asset, 'holder', context),
    version: optionalString(asset, 'version', context),
    licenseId: requiredString(asset, 'license_id', context),
    licenseUrls: requiredStringList(asset, 'license_urls', context),
    paths: requiredStringList(asset, 'paths', context),
  };
}

function parsePanel(value: unknown): PanelSurfaceCredits {
  const context = 'surfaces.panel';
  const panel = asRecord(value, context);
  const attribution = panel['attribution'];
  const assets = panel['assets'];
  if (!Array.isArray(attribution) || attribution.length === 0) {
    throw new Error(`credits.json ${context}.attribution: expected a non-empty array`);
  }
  if (!Array.isArray(assets) || assets.length === 0) {
    throw new Error(`credits.json ${context}.assets: expected a non-empty array`);
  }
  return {
    title: requiredString(panel, 'title', context),
    attribution: attribution.map((entry, index) => parseLink(entry, `${context}.attribution[${index}]`)),
    firstParty: requiredStringList(panel, 'first_party', context),
    transitiveDependencies: optionalString(panel, 'transitive_dependencies', context),
    assets: assets.map((entry, index) => parseAsset(entry, index)),
  };
}

function parseLicense(value: unknown): ProjectLicense {
  const context = 'license';
  const license = asRecord(value, context);
  return {
    spdxId: requiredString(license, 'spdx_id', context),
    name: requiredString(license, 'name', context),
    url: requiredString(license, 'url', context),
  };
}

function parsePanelCreditsPage(value: unknown): PanelCreditsPage {
  const root = asRecord(value, 'root');
  const project = asRecord(root['project'], 'project');
  const upstream = asRecord(project['upstream'], 'project.upstream');
  return {
    projectName: requiredString(project, 'name', 'project'),
    sourceUrl: requiredString(project, 'url', 'project'),
    upstream: {
      name: requiredString(upstream, 'name', 'project.upstream'),
      url: requiredString(upstream, 'url', 'project.upstream'),
    },
    license: parseLicense(root['license']),
    panel: parsePanel(asRecord(root['surfaces'], 'surfaces')['panel']),
  };
}

const PANEL_CREDITS: PanelCreditsPage = parsePanelCreditsPage(creditsData);

/** The panel surface only: another surface's assets are not shipped in this bundle. */
export function panelCredits(): PanelCreditsPage {
  return PANEL_CREDITS;
}