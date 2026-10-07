import { directPageRoute, recordRoute, tabRoute } from '@/lib/navigation/registry-descriptors';
import type { RouteDescriptor } from '@/lib/navigation/types';

// Why: the competition slice is the direct dashboard plus the Contest and Task
// record trees, whose physical routes the foundation and Task plans already ship.
export const COMPETITION_ROUTES: readonly RouteDescriptor[] = [
  directPageRoute('home', '/', {}, []),
  directPageRoute('contests.list', '/contests', { all: ['contest:list'] }, []),
  { ...recordRoute(
    'contests.record',
    '/contests/[id]',
    'contests.list',
    { all: ['contest:read'] },
    ['contests.tabs.overview', 'contests.tabs.tasks', 'contests.tabs.participants', 'contests.tabs.communications', 'contests.tabs.settings'],
    'contests.tabs.overview',
  ), enabled: true },
  { ...tabRoute('contests.tabs.overview', '/contests/[id]/overview', 'contests.record', { all: ['contest:read'] }), enabled: true },
  { ...tabRoute('contests.tabs.tasks', '/contests/[id]/tasks', 'contests.record', { all: ['contest:read', 'task:read'] }), enabled: true },
  { ...tabRoute('contests.tabs.participants', '/contests/[id]/participants', 'contests.record', { all: ['contest:read', 'participation:read', 'user:read'] }), enabled: true },
  { ...tabRoute('contests.tabs.communications', '/contests/[id]/communications', 'contests.record', { all: ['contest:read', 'announcement:read', 'question:read', 'ranking:read'] }), enabled: true },
  { ...tabRoute('contests.tabs.settings', '/contests/[id]/settings', 'contests.record', { all: ['contest:read'] }), enabled: true },
  directPageRoute('tasks.list', '/tasks', { all: ['task:list'] }, []),
  { ...recordRoute('tasks.record', '/tasks/[id]', 'tasks.list', { all: ['task:read'] }, ['tasks.tabs.overview', 'tasks.tabs.datasets', 'tasks.tabs.files', 'tasks.tabs.settings'], 'tasks.tabs.overview'), enabled: true },
  { ...tabRoute('tasks.tabs.overview', '/tasks/[id]/overview', 'tasks.record', { all: ['task:read', 'statement:read'] }), enabled: true },
  { ...tabRoute('tasks.tabs.datasets', '/tasks/[id]/datasets', 'tasks.record', { all: ['task:read', 'dataset:read'] }), enabled: true },
  { ...tabRoute('tasks.tabs.files', '/tasks/[id]/files', 'tasks.record', { all: ['task:read', 'attachment:read'] }), enabled: true },
  { ...tabRoute('tasks.tabs.settings', '/tasks/[id]/settings', 'tasks.record', { all: ['task:read'] }), enabled: true },
];
