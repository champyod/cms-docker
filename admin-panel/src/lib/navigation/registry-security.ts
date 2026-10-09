import { GROUP_PAGE_SURFACES_WITHOUT_CHORD, enabledPageRoute } from '@/lib/navigation/registry-descriptors';
import type { RouteDescriptor, RouteId } from '@/lib/navigation/types';

// The security surface: one field per permission family, so a reader who may
// lift a block is never offered the WAF editor. None of these takes a g-chord
// letter — the free letters are spent, and every field is reachable by name.
export const SECURITY_ROUTE_IDS = [
  'security.overview',
  'security.waf',
  'security.blocks',
  'security.tls',
] as const satisfies readonly RouteId[];

export const SECURITY_ROUTES: readonly RouteDescriptor[] = [
  enabledPageRoute('security.overview', '/security/overview', { all: ['security:read'] }, [], GROUP_PAGE_SURFACES_WITHOUT_CHORD),
  enabledPageRoute('security.waf', '/security/waf', { all: ['security:read', 'waf:read'] }, [], GROUP_PAGE_SURFACES_WITHOUT_CHORD),
  enabledPageRoute(
    'security.blocks',
    '/security/blocks',
    { all: ['security:read'], any: ['ban:read', 'lockout:read'] },
    [],
    GROUP_PAGE_SURFACES_WITHOUT_CHORD,
  ),
  enabledPageRoute('security.tls', '/security/tls', { all: ['security:read', 'tls:read'] }, [], GROUP_PAGE_SURFACES_WITHOUT_CHORD),
];
