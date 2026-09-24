import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppearanceClient } from '@/components/appearance/AppearanceClient';
import { TableToolbar } from '@/components/core/TableToolbar';
import { EnvSectionCard } from '@/components/settings/EnvSectionCard';

function getInputTouchHeightCount(markup: string): number {
  const inputTags = markup.match(/<input[^>]*>/g) ?? [];
  return inputTags.filter((inputTag) => {
    const className = inputTag.match(/\bclass="([^"]*)"/)?.[1] ?? '';
    return /\bh-11\b/.test(className);
  }).length;
}

describe('raw form field touch targets', () => {
  it('gives the user search input a 44px touch target', () => {
    const markup = renderToStaticMarkup(
      <TableToolbar
        searchText=""
        onSearchTextChange={() => undefined}
        onSearchSubmit={() => undefined}
        searchPlaceholder="Search users..."
      />,
    );

    expect(getInputTouchHeightCount(markup)).toBe(1);
  });

  it('gives all appearance branding inputs a 44px touch target', () => {
    const markup = renderToStaticMarkup(<AppearanceClient locale="en" />);

    expect(getInputTouchHeightCount(markup)).toBe(3);
  });

  it('gives each environment settings input a 44px touch target', () => {
    const markup = renderToStaticMarkup(
      <EnvSectionCard
        section={{
          title: 'Database Configuration',
          filename: 'config.toml',
          fields: [
            { key: 'POSTGRES_DB', tomlSection: 'core', label: 'Database Name' },
            { key: 'POSTGRES_USER', tomlSection: 'core', label: 'Database User' },
          ],
        }}
        data={{ 'config.toml': { POSTGRES_DB: 'cms', POSTGRES_USER: 'cms' } }}
        originalData={{ 'config.toml': { POSTGRES_DB: 'cms', POSTGRES_USER: 'cms' } }}
        saving={false}
        hasPendingRestarts={false}
        onPersist={async () => undefined}
        onChange={() => undefined}
      />,
    );

    expect(getInputTouchHeightCount(markup)).toBe(2);
  });
});
