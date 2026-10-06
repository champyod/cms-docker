import { Stack } from '@/components/core/Layout';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/core/Table';
import { Text } from '@/components/core/Typography';
import { getDictionary } from '@/i18n';
import type { Dictionary } from '@/lib/dictionary';
import { panelCredits } from '@/lib/credits';
import type { CreditsAsset } from '@/lib/credits';

type AboutCopy = Dictionary['about'];

const EXTERNAL_LINK = 'text-indigo-400 hover:text-indigo-300';

function ExternalLink({ href, children }: { readonly href: string; readonly children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={EXTERNAL_LINK}>
      {children}
    </a>
  );
}

function LabeledValue({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Text variant="label">{label}</Text>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function LicenceCell({ asset }: { readonly asset: CreditsAsset }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-xs text-foreground">{asset.licenseId}</span>
      {asset.licenseUrls.map((url) => (
        <ExternalLink key={url} href={url}>
          {url}
        </ExternalLink>
      ))}
    </div>
  );
}

function PathsCell({ asset }: { readonly asset: CreditsAsset }) {
  return (
    <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
      {asset.paths.map((path) => (
        <li key={path} className="font-mono break-all">{path}</li>
      ))}
    </ul>
  );
}

function AssetsTable({ assets, copy }: { readonly assets: readonly CreditsAsset[]; readonly copy: AboutCopy }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{copy.columns.name}</TableHead>
          <TableHead>{copy.columns.version}</TableHead>
          <TableHead>{copy.columns.holder}</TableHead>
          <TableHead>{copy.columns.license}</TableHead>
          <TableHead>{copy.columns.paths}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assets.map((asset) => (
          <TableRow key={asset.name}>
            <TableCell className="font-medium text-foreground">{asset.name}</TableCell>
            <TableCell className="font-mono text-xs">{asset.version ?? '—'}</TableCell>
            <TableCell>{asset.holder}</TableCell>
            <TableCell><LicenceCell asset={asset} /></TableCell>
            <TableCell><PathsCell asset={asset} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default async function SystemAboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const copy = dict.about;
  const { projectName, sourceUrl, upstream, license, panel } = panelCredits();
  return (
    <Stack gap={12} className="mx-auto max-w-5xl">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <LabeledValue label={copy.project}>
          <span className="font-medium">{projectName}</span>
        </LabeledValue>
        <LabeledValue label={copy.source}>
          <ExternalLink href={sourceUrl}>{sourceUrl}</ExternalLink>
        </LabeledValue>
        <LabeledValue label={copy.upstream}>
          <ExternalLink href={upstream.url}>{upstream.name}</ExternalLink>
        </LabeledValue>
        <LabeledValue label={copy.license}>
          <span>{license.name}</span>
          <span className="font-mono text-xs text-muted-foreground"> ({license.spdxId})</span>{' '}
          <ExternalLink href={license.url}>{license.url}</ExternalLink>
        </LabeledValue>
      </div>
      <section className="space-y-4">
        <Text as="h2" variant="h2">{panel.title}</Text>
        <div className="space-y-2">
          <Text variant="label">{copy.attribution}</Text>
          <ul className="space-y-1 text-sm text-foreground">
            {panel.attribution.map((entry) => (
              <li key={entry.url}>
                <ExternalLink href={entry.url}>{entry.text}</ExternalLink>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <Text variant="label">{copy.firstParty}</Text>
          <ul className="list-inside list-disc space-y-1 font-mono text-xs text-muted-foreground">
            {panel.firstParty.map((path) => <li key={path} className="break-all">{path}</li>)}
          </ul>
        </div>
        {panel.transitiveDependencies !== null && (
          <div className="space-y-2">
            <Text variant="label">{copy.transitiveDependencies}</Text>
            <p className="text-sm text-muted-foreground">{panel.transitiveDependencies}</p>
          </div>
        )}
      </section>
      <section className="space-y-4">
        <Text as="h2" variant="h2">
          {copy.softwareCount.replace('{count}', String(panel.assets.length))}
        </Text>
        <AssetsTable assets={panel.assets} copy={copy} />
      </section>
    </Stack>
  );
}