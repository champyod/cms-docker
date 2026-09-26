'use client';

import { Eye, FileCode, HelpCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { EmptyState } from '@/components/core/EmptyState';
import { RecordList } from '@/components/list/RecordList';
import { RecordListPager } from '@/components/list/RecordListPager';
import { RowActionLink } from '@/components/list/RowActionLink';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useSyncedState } from '@/hooks/useSyncedState';
import type { Dictionary } from '@/lib/dictionary';
import { buildRoute } from '@/lib/navigation/routes';
import type { SubmissionListItem } from '@/types';

import { buildSubmissionColumns } from './submissionColumns';

export interface SubmissionListProps {
  readonly initialSubmissions: readonly SubmissionListItem[];
  readonly totalPages: number;
  readonly currentPage: number;
  readonly navigation: Dictionary['navigation'];
}

function recordHref(locale: string, submission: SubmissionListItem): string {
  return buildRoute(locale, 'evaluation.submission-record', { id: submission.id });
}

function SubmissionListHeader({ locale, currentPage, totalPages }: {
  locale: string;
  currentPage: number;
  totalPages: number;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Link href={`/${locale}/docs#submissions`} className="flex h-11 w-11 items-center justify-center p-1 hover:bg-accent rounded-full transition-colors text-muted-foreground hover:text-primary" title="View Documentation">
        <HelpCircle className="w-4 h-4" />
      </Link>
      <div className="text-sm text-muted-foreground">
        Page {currentPage} of {totalPages}
      </div>
    </div>
  );
}

export function SubmissionList({ initialSubmissions, totalPages, currentPage, navigation }: SubmissionListProps): React.JSX.Element {
  const [submissions] = useSyncedState(initialSubmissions);
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const router = useAppRouter();
  // Why the generated record label: the row action opens the submission record,
  // so its accessible name comes from the same bilingual key the record uses.
  const recordLabel = navigation.evaluation['submission-record'].label;

  const handlePageChange = (newPage: number): void => {
    const url = new URL(window.location.href);
    url.searchParams.set('page', newPage.toString());
    router.push(url.toString());
  };

  return (
    <div className="space-y-6">
      <SubmissionListHeader locale={locale} currentPage={currentPage} totalPages={totalPages} />
      <RecordList
        rows={submissions}
        columns={buildSubmissionColumns()}
        getRowKey={(submission) => submission.id}
        getRecordHref={(submission) => recordHref(locale, submission)}
        renderRowActions={(submission) => (
          <RowActionLink href={recordHref(locale, submission)} label={`${recordLabel} ${submission.id}`} icon={<Eye />} isPrimary />
        )}
        emptyState={
          <EmptyState icon={FileCode} title="No submissions found" description="Submissions will appear here once contestants start submitting." />
        }
      />
      <RecordListPager currentPage={currentPage} totalPages={totalPages} onPageChange={handlePageChange} />
    </div>
  );
}
