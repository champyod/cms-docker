import { SectionCard } from '@/components/core/SectionCard';
import { DetailPage, type DetailFact } from '@/components/patterns/DetailPage';
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

// Why a token and not a palette step: this page is declared, so it has to be measurable in light,
// dark and high contrast - an indigo literal looks the same in all three.
const EXTERNAL_LINK = 'text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground';

function ExternalLink({ href, children }: { readonly href: string; readonly children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={EXTERNAL_LINK}>
      {children}
    </a>
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

/**
 * The panel's own record: what it is, who wrote it, what it carries.
 *
 * WHY a detail: the page describes one record - this panel - with a handful of values and three
 * sections that belong to it. There is nothing to list, nothing to count and nothing to change, so
 * the only layout whose shape the page actually has is the one that leads with the values and then
 * shows what belongs to them.
 */
export default async function SystemAboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<React.JSX.Element> {
  const { locale } = await params;
  const dict = await getDictionary(locale);
  const copy = dict.about;
  const { projectName, projectAuthor, sourceUrl, upstream, license, panel } = panelCredits();
  const facts: readonly DetailFact[] = [
    { term: copy.project, value: projectName },
    { term: copy.upstream, value: upstream.name },
    { term: copy.license, value: license.name },
  ];
  return (
    <DetailPage
      // The system module shell renders this page's name, description and trail.
      ownsHeader={false}
      facts={facts}
    >
      {/* The byline the scoreboard sidebar carries, and the two addresses a licence has to offer:
          the values above say what this is, this line says where to get it. */}
      <Text>
        {projectAuthor === null ? projectName : `${projectName} by ${projectAuthor}`}
        {panel.attribution.length > 0 ? ` · ${panel.attribution[0].text}` : ''}
        {' · '}
        <ExternalLink href={sourceUrl}>{sourceUrl}</ExternalLink>
        {' · '}
        <ExternalLink href={license.url}>{license.spdxId}</ExternalLink>
      </Text>
      <SectionCard title={copy.contributors.title}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{copy.contributors.name}</TableHead>
              <TableHead>{copy.contributors.contribution}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projectAuthor !== null && (
              <TableRow>
                <TableCell><ExternalLink href={sourceUrl}>{projectAuthor}</ExternalLink></TableCell>
                <TableCell>{copy.contributors.maintainer}</TableCell>
              </TableRow>
            )}
            <TableRow>
              <TableCell><ExternalLink href={upstream.url}>{upstream.name}</ExternalLink></TableCell>
              <TableCell>{copy.contributors.upstream}</TableCell>
            </TableRow>
            {panel.attribution.map((entry) => (
              <TableRow key={entry.url}>
                <TableCell><ExternalLink href={entry.url}>{entry.text}</ExternalLink></TableCell>
                <TableCell>{copy.attribution}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SectionCard>
      <SectionCard title={panel.title}>
        <div className="space-y-2">
          <Text variant="label">{copy.firstParty}</Text>
          <ul className="list-inside list-disc space-y-1 font-mono text-[length:var(--text-label)] text-muted-foreground">
            {panel.firstParty.map((path) => <li key={path} className="break-all">{path}</li>)}
          </ul>
        </div>
        {panel.transitiveDependencies !== null && (
          <div className="space-y-2">
            <Text variant="label">{copy.transitiveDependencies}</Text>
            <Text variant="muted">{panel.transitiveDependencies}</Text>
          </div>
        )}
      </SectionCard>
      <SectionCard
        title={copy.software}
        count={panel.assets.length}
      >
        <AssetsTable assets={panel.assets} copy={copy} />
      </SectionCard>
    </DetailPage>
  );
}
