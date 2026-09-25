import { pageRoute, recordRoute, tabRoute } from '@/lib/navigation/registry-descriptors';
import type { RouteDescriptor } from '@/lib/navigation/types';

// Why: the Evaluation slice ships with Task 4, so every descriptor here stays
// disabled until that task creates and tests the physical Submission routes.
export const EVALUATION_ROUTES: readonly RouteDescriptor[] = [
  pageRoute('evaluation.submissions', '/evaluation/submissions', { all: ['submission:list'] }, ['/submissions']),
  recordRoute(
    'evaluation.submission-record',
    '/evaluation/submissions/[id]',
    'evaluation.submissions',
    { all: ['submission:read'] },
    ['evaluation.submission-tabs.summary', 'evaluation.submission-tabs.results', 'evaluation.submission-tabs.logs', 'evaluation.submission-tabs.evaluation'],
    'evaluation.submission-tabs.summary',
  ),
  tabRoute('evaluation.submission-tabs.summary', '/evaluation/submissions/[id]/summary', 'evaluation.submission-record', { all: ['submission:read'] }),
  tabRoute('evaluation.submission-tabs.results', '/evaluation/submissions/[id]/results', 'evaluation.submission-record', { all: ['submission:read', 'submissionresult:read', 'file:read'] }),
  tabRoute('evaluation.submission-tabs.logs', '/evaluation/submissions/[id]/logs', 'evaluation.submission-record', { all: ['submission:read', 'submissionresult:read'] }),
  tabRoute('evaluation.submission-tabs.evaluation', '/evaluation/submissions/[id]/evaluation', 'evaluation.submission-record', { all: ['submission:read', 'evaluation:read'] }),
  pageRoute('evaluation.lanes', '/evaluation/lanes', { all: ['evaluation:list'] }, ['/submissions/lanes']),
];
