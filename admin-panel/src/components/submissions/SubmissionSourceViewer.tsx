'use client';

import { useEffect, useState } from 'react';
// Why the theme belongs to the viewer: the code surface is the only place the
// panel renders highlight.js markup, and the theme ships with the library.
import 'highlight.js/styles/github-dark.css';

import { getFileByDigest } from '@/app/actions/statements';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { InlineAlert } from '@/components/core/InlineAlert';
import { useDictionary } from '@/hooks/useDictionary';
import type { SubmissionSourceModel } from '@/lib/evaluation-read-model-types';
import { cn } from '@/lib/utils';

import { decodeBase64Source, SubmissionFileActions } from './SubmissionFileActions';
import { highlightSource } from './source-highlight';

const PREVIEW_CHARACTER_COUNT = 50;
const CODE_BLOCK_CLASS = 'hljs max-h-96 overflow-auto rounded-lg border border-border p-3 font-mono text-xs';
const COLLAPSE_FADE_CLASS = 'pointer-events-none absolute inset-x-0 bottom-0 h-8 rounded-b-lg bg-gradient-to-t from-card to-transparent';

export interface SubmissionSourceViewerProps {
  /** Null when the submission stores no file at all. */
  readonly source: SubmissionSourceModel | null;
}

interface SourceCodeProps {
  readonly filename: string;
  readonly language: string | null;
  readonly digest: string;
}

// Why an explicit reason: an unreadable file is a permission boundary, so the
// panel names the key instead of rendering an empty viewer that reads as missing data.
function HiddenSource({ label }: { readonly label: string }): React.JSX.Element {
  return (
    <InlineAlert tone="info" density="compact">
      {label}
    </InlineAlert>
  );
}

function SourceBody({ source, emptyLabel, hiddenLabel }: {
  readonly source: SubmissionSourceModel | null;
  readonly emptyLabel: string;
  readonly hiddenLabel: string;
}): React.JSX.Element {
  if (source === null) return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  if (!source.sourceReadable) return <HiddenSource label={hiddenLabel} />;
  return <SourceCode filename={source.filename} language={source.language} digest={source.digest} />;
}

function SourceCode({ filename, language, digest }: SourceCodeProps): React.JSX.Element {
  const source = useDictionary().submissions.record.source;
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [wrap, setWrap] = useState(true);

  // Why the digest: the code bytes are a content-addressed fsobject, so the panel
  // asks for them only here, once the viewer is actually on screen.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const file = await getFileByDigest(digest);
        if (cancelled) return;
        if (file === null) {
          setError(source.noContents);
          return;
        }
        setCode(decodeBase64Source(file.data));
      } catch (cause: unknown) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : source.noContents);
      }
    })();
    return () => { cancelled = true; };
  }, [digest, source.noContents]);

  if (error !== null) return <InlineAlert tone="destructive" density="compact">{error}</InlineAlert>;
  if (code === null) return <p role="status" className="text-sm text-muted-foreground">{source.loading}</p>;

  const truncated = code.length > PREVIEW_CHARACTER_COUNT;
  const preview = truncated ? code.slice(0, PREVIEW_CHARACTER_COUNT) + '…' : code;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{filename}</span>
        <div className="flex flex-wrap items-center gap-1">
          <SubmissionFileActions file={{ filename, digest }} />
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
          >
            {source.wrap}
          </Button>
          {truncated && (
            <Button variant="secondary" size="sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? source.collapse : source.showFull}
            </Button>
          )}
        </div>
      </div>
      <div className="relative">
        <pre className={cn(CODE_BLOCK_CLASS, wrap && 'whitespace-pre-wrap break-words')}>
          <code dangerouslySetInnerHTML={{ __html: highlightSource(expanded ? code : preview, language) }} />
        </pre>
        {!expanded && truncated && <div aria-hidden="true" className={COLLAPSE_FADE_CLASS} />}
      </div>
    </div>
  );
}

export function SubmissionSourceViewer({ source }: SubmissionSourceViewerProps): React.JSX.Element {
  const copy = useDictionary().submissions.record.source;
  return (
    <Card className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{copy.title}</h3>
      <SourceBody source={source} emptyLabel={copy.empty} hiddenLabel={copy.hidden} />
    </Card>
  );
}
