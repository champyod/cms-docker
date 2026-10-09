import type { ReactNode } from 'react';
import type { PermissionKey } from '@/lib/permissions';

export type RouteId =
  | 'home'
  | 'contests.list'
  | 'contests.record'
  | 'contests.tabs.overview'
  | 'contests.tabs.tasks'
  | 'contests.tabs.participants'
  | 'contests.tabs.communications'
  | 'contests.tabs.settings'
  | 'tasks.list'
  | 'tasks.record'
  | 'tasks.tabs.overview'
  | 'tasks.tabs.datasets'
  | 'tasks.tabs.files'
  | 'tasks.tabs.settings'
  | 'people.users'
  | 'people.user-record'
  | 'people.user-tabs.profile'
  | 'people.user-tabs.teams'
  | 'people.user-tabs.history'
  | 'people.teams'
  | 'people.team-record'
  | 'people.team-tabs.overview'
  | 'people.team-tabs.members'
  | 'people.team-tabs.contests'
  | 'evaluation.submissions'
  | 'evaluation.submission-record'
  | 'evaluation.submission-tabs.summary'
  | 'evaluation.submission-tabs.results'
  | 'evaluation.submission-tabs.logs'
  | 'evaluation.submission-tabs.evaluation'
  | 'evaluation.lanes'
  | 'administration.admins'
  | 'administration.groups'
  | 'administration.audit'
  | 'security.overview'
  | 'security.waf'
  | 'security.blocks'
  | 'security.tls'
  | 'infrastructure.deployments'
  | 'infrastructure.containers'
  | 'infrastructure.resources'
  | 'infrastructure.ranking'
  | 'system.appearance'
  | 'system.maintenance'
  | 'system.backup-restore'
  | 'system.settings'
  | 'system.docs'
  | 'system.about'
  | 'system.search'
  | 'auth.signout';

export type RouteKind = 'page' | 'record-landing' | 'nested-tab' | 'search';
export type NavigationSurface =
  | 'sidebar'
  | 'mobile-primary'
  | 'mobile-more'
  | 'palette'
  | 'search'
  | 'shortcuts'
  | 'tabs'
  | 'breadcrumbs';

export type RouteParams = Readonly<Record<string, string | number>>;

export type PermissionRequirement = {
  all?: readonly PermissionKey[];
  any?: readonly PermissionKey[];
};

export interface RouteDescriptor {
  readonly id: RouteId;
  readonly path: string;
  readonly kind: RouteKind;
  readonly parentId?: RouteId;
  readonly permission: PermissionRequirement;
  readonly labelKey: string;
  readonly legacyPaths: readonly string[];
  readonly defaultChildId?: RouteId;
  readonly tabIds: readonly RouteId[];
  readonly surfaces: readonly NavigationSurface[];
  readonly enabled: boolean;
}

export interface NavigationGroupDescriptor {
  readonly id: 'direct' | 'people' | 'evaluation' | 'administration' | 'security' | 'infrastructure' | 'system';
  readonly labelKey: string;
  readonly routeIds: readonly RouteId[];
}

export interface LegacyRedirectRule {
  readonly path: string;
  readonly preferredRouteId: RouteId;
}

export interface BreadcrumbItem {
  readonly label: string;
  readonly href?: string;
}

export interface RouteTab {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon?: ReactNode;
}
