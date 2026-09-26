import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

describe('Infrastructure feature-owned PageSurface composition', () => {
  it.each([
    'src/components/deployments/DeploymentsClient.tsx',
    'src/components/containers/ContainersClient.tsx',
    'src/components/resources/ResourceView.tsx',
    'src/components/ranking/RankingClient.tsx',
  ])('%s owns its PageSurface', (relativePath) => {
    const source = readSource(relativePath);
    expect(source).toContain('<PageSurface');
    expect(source).toContain('breadcrumbs=');
    expect(source).toContain('copy.title');
  });
});
