import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

// Why the surfaces and not the pages: each panel is the client body a page's layout slots render,
// and the header it must not draw belongs to the module shell above both of them.
const PANEL_PATHS = [
  'src/components/deployments/DeploymentsSurface.tsx',
  'src/components/containers/ContainersSurface.tsx',
  'src/components/resources/ResourceView.tsx',
  'src/components/ranking/RankingLogoCard.tsx',
] as const;

describe('Infrastructure module field shell composition', () => {
  it.each(PANEL_PATHS)('%s renders panel content only', (relativePath) => {
    const source = readSource(relativePath);
    // The title, description, and trail belong to the layout; a panel carrying them would double the header.
    expect(source).not.toContain('<PageSurface');
    expect(source).not.toContain('breadcrumbs=');
    expect(source).not.toContain('copy.title');
  });

  it('keeps every infrastructure field behind the one module layout shell', () => {
    const layout = readSource('src/app/[locale]/(authenticated)/infrastructure/layout.tsx');
    expect(layout).toContain('<ModuleShell');
    expect(layout).toContain('buildModuleFields(GROUP_ID, locale, dict, effective)');
    expect(layout).toContain('listBreadcrumbs(locale, GROUP_ID, DEPLOYMENTS_FIELD_ID, dict)');
  });
});