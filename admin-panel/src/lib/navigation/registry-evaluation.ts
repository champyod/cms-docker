import { pageRoute, recordRoute, tabRoute } from '@/lib/navigation/registry-descriptors';
import type { RouteDescriptor } from '@/lib/navigation/types';

// Why: the Evaluation shell ships the canonical Submission list, the lane module,
// and the Submission record landing with its four tabs, so all of those
// descriptors are enabled; no Evaluation descriptor stays disabled.
export const EVALUATION_ROUTES: readonly RouteDescriptor[] = [
  { ...pageRoute('evaluation.submissions', '/evaluation/submissions', { all: ['submission:list'] }, ['/submissions']), enabled: true },
  {
    ...recordRoute(
      'evaluation.submission-record',
      '/evaluation/submissions/[id]',
      'evaluation.submissions',
      { all: ['submission:read'] },
      ['evaluation.submission-tabs.summary', 'evaluation.submission-tabs.results', 'evaluation.submission-tabs.logs', 'evaluation.submission-tabs.evaluation'],
      'evaluation.submission-tabs.summary',
    ),
    enabled: true,
  },
  { ...tabRoute('evaluation.submission-tabs.summary', '/evaluation/submissions/[id]/summary', 'evaluation.submission-record', { all: ['submission:read'] }), enabled: true },
  { ...tabRoute('evaluation.submission-tabs.results', '/evaluation/submissions/[id]/results', 'evaluation.submission-record', { all: ['submission:read', 'submissionresult:read', 'file:read'] }), enabled: true },
  { ...tabRoute('evaluation.submission-tabs.logs', '/evaluation/submissions/[id]/logs', 'evaluation.submission-record', { all: ['submission:read', 'submissionresult:read'] }), enabled: true },
  { ...tabRoute('evaluation.submission-tabs.evaluation', '/evaluation/submissions/[id]/evaluation', 'evaluation.submission-record', { all: ['submission:read', 'evaluation:read'] }), enabled: true },
  { ...pageRoute('evaluation.lanes', '/evaluation/lanes', { all: ['evaluation:list'] }, ['/submissions/lanes']), enabled: true },
];
