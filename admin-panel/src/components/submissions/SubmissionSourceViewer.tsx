'use client';

import { useEffect, useState } from 'react';
// Why the theme belongs to the viewer: the code surface is the only place the
// panel renders highlight.js markup, and the theme ships with the library.
import 'highlight.js/styles/github-dark.css';

import { getFileByDigest } from '@/app/actions/statements';
import { Button } from '@/components/core/Button';
import { Card } from '@/components/core/Card';
import { InlineAlert } from '@/components/core/InlineAlert';
import type { SubmissionSourceModel } from '@/lib/evaluation-read-model-types';
import { decodeFileBytes, detectFileEncoding } from '@/lib/file-encoding';

import { highlightSource } from './source-highlight';

const PREVIEW_CHARACTER_COUNT = 50;
const CODE_BLOCK_CLASS = 'hljs max-h-96 overflow-auto rounded-lg border border-border p-3 font-mono text-xs';

export interface SubmissionSourceViewerProps {
  /** Null when the submission stores no file at all. */
  readonly source: SubmissionSourceModel | null;
}

interface SourceCodeProps {
  readonly filename: string;
  readonly language: string | null;
  readonly digest: string;
}

function decodeBase64Source(data: string): string {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return decodeFileBytes(bytes, detectFileEncoding(bytes));
}

// Why an explicit reason: an unreadable file is a permission boundary, so the
// panel names the key instead of rendering an empty viewer that reads as missing data.
function HiddenSource(): React.JSX.Element {
  return (
    <InlineAlert tone="info" density="compact">
      Hidden — requires file:read
    </InlineAlert>
  );
}

function SourceBody({ source }: { readonly source: SubmissionSourceModel | null }): React.JSX.Element {
  if (source === null) return <p className="text-sm text-muted-foreground">No stored source file.</p>;
  if (!source.sourceReadable) return <HiddenSource />;
  return <SourceCode filename={source.filename} language={source.language} digest={source.digest} />;
}

function SourceCode({ filename, language, digest }: SourceCodeProps): React.JSX.Element {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Why the digest: the code bytes are a content-addressed fsobject, so the panel
  // asks for them only here, once the viewer is actually on screen.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const file = await getFileByDigest(digest);
        if (cancelled) return;
        if (file === null) {
          setError('No stored contents for this file.');
          return;
        }
        setCode(decodeBase64Source(file.data));
      } catch (cause: unknown) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not read the stored file.');
      }
    })();
    return () => { cancelled = true; };
  }, [digest]);

  if (error !== null) return <InlineAlert tone="destructive" density="compact">{error}</InlineAlert>;
  if (code === null) return <p role="status" className="text-sm text-muted-foreground">Loading source…</p>;

  const truncated = code.length > PREVIEW_CHARACTER_COUNT;
  const shown = expanded ? code : code.slice(0, PREVIEW_CHARACTER_COUNT);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">{filename}</span>
        {truncated && (
          <Button variant="secondary" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Collapse' : 'Show full code'}
          </Button>
        )}
      </div>
      <pre className={CODE_BLOCK_CLASS}>
        <code dangerouslySetInnerHTML={{ __html: highlightSource(shown, language) }} />
      </pre>
    </div>
  );
}

/**
 * Renders the submission's source: a first-50-character preview that expands to
 * the full text, highlighted in the browser, with the file fetched on render.
 */
export function SubmissionSourceViewer({ source }: SubmissionSourceViewerProps): React.JSX.Element {
  return (
    <Card className="space-y-3">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Source code</h3>
      <SourceBody source={source} />
    </Card>
  );
}
