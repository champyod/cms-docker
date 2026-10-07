import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

const PANEL_PATHS = [
  'src/components/deployments/DeploymentsClient.tsx',
  'src/components/containers/ContainersClient.tsx',
  'src/components/resources/ResourceView.tsx',
  'src/components/ranking/RankingClient.tsx',
] as const;

describe('Infrastructure module tab shell composition', () => {
  it.each(PANEL_PATHS)('%s renders panel content only', (relativePath) => {
    const source = readSource(relativePath);
    // Why the absences: the title, description, and trail of an infrastructure tab are
    // the module layout's, so a panel that still carried them would render a second
    // header row above the tabs the layout already drew.
    expect(source).not.toContain('<PageSurface');
    expect(source).not.toContain('breadcrumbs=');
    expect(source).not.toContain('copy.title');
  });

  it('keeps every infrastructure tab behind the one module layout shell', () => {
    const layout = readSource('src/app/[locale]/(authenticated)/infrastructure/layout.tsx');
    expect(layout).toContain('<ModuleTabShell');
    expect(layout).toContain('buildModuleTabs(GROUP_ID, locale, dict, effective)');
    expect(layout).toContain('listBreadcrumbs(locale, GROUP_ID, DEPLOYMENTS_TAB_ID, dict)');
  });
});