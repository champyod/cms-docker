'use client';

import { useEffect, useState } from 'react';

import { Card } from '@/components/core/Card';
import { EmptyState } from '@/components/core/EmptyState';
import { InlineAlert } from '@/components/core/InlineAlert';
import { Loading } from '@/components/core/Loading';
import { useDictionary } from '@/hooks/useDictionary';
import { interpolate } from '@/lib/interpolate';
import { previewRegistryAction, type PreviewResult } from '@/app/actions/serviceWiring';
import { PANEL_READ_TIMEOUT_MS, withTimeout } from '@/lib/with-timeout';
import type { Dictionary } from '@/lib/dictionary';
import type { RegistryArtifact } from '@/lib/service-wiring-cli';

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'ready'; artifacts: RegistryArtifact[] }
  | { kind: 'error'; message: string };

type PreviewCopy = Dictionary['infrastructure']['services']['preview'];

/**
 * The heading and hot-apply instruction for one artifact.
 *
 * WHY three cases and not two: a `location` artifact is a fragment the front's nginx includes, so
 * it is labelled as nginx config and applied by re-syncing and reloading the front — the serve
 * instruction ("recreate that node") names a tailnet node the fragment never touches.
 */
function artifactCopy(copy: PreviewCopy, artifact: RegistryArtifact): { title: string; hotApply: string } {
  if (artifact.mode === 'nginx') return { title: copy.nginxTitle, hotApply: copy.nginxHotApply };
  if (artifact.mode === 'location') {
    return { title: interpolate(copy.locationTitle, { node: artifact.node ?? '' }), hotApply: copy.locationHotApply };
  }
  return { title: interpolate(copy.serveTitle, { node: artifact.node ?? '' }), hotApply: copy.serveHotApply };
}

/**
 * The generated config the next sync would write, each artifact beside its hot-apply class.
 *
 * WHY the read is a server action: the renderer is pure, but the rows it renders come from
 * the registry and the permission boundary, so the client asks the server for the artifacts
 * rather than reading the registry itself.
 */
export function PreviewPanel(): React.JSX.Element {
  const services = useDictionary().infrastructure.services;
  const copy = services.preview;
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    // Why `active`: the tab can unmount mid-read, and a late result must not set state on it.
    void withTimeout(previewRegistryAction(), PANEL_READ_TIMEOUT_MS, copy.errorFallback)
      .then((result: PreviewResult): void => {
        if (active) {
          setState(result.success ? { kind: 'ready', artifacts: result.artifacts } : { kind: 'error', message: result.error });
        }
      })
      .catch((error: unknown): void => {
        if (active) setState({ kind: 'error', message: error instanceof Error ? error.message : copy.errorFallback });
      });
    return (): void => { active = false; };
  }, [copy]);

  if (state.kind === 'loading') return <Loading text={copy.title} />;
  if (state.kind === 'error') {
    return <InlineAlert tone="destructive" title={copy.errorTitle}>{state.message}</InlineAlert>;
  }

  const rendered = state.artifacts.filter((artifact) => artifact.content !== '');
  if (rendered.length === 0) return <EmptyState title={services.empty.preview} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{copy.description}</p>
      {rendered.map((artifact) => {
        const card = artifactCopy(copy, artifact);
        return (
          <Card key={artifact.node ?? artifact.mode} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-foreground">{card.title}</h2>
              <span className="text-xs text-muted-foreground">{card.hotApply}</span>
            </div>
            <pre className="overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">{artifact.content}</pre>
          </Card>
        );
      })}
      <p className="text-xs text-muted-foreground">{copy.mountedNote}</p>
    </div>
  );
}
