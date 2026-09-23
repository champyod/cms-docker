import type { GroupWithPermissions } from '@/app/actions/adminPermissions';

export interface GroupsDict {
  title: string;
  subtitle: string;
  createGroup: string;
  editGroup: string;
  name: string;
  description: string;
  isSeeded: string;
  permissions: string;
  save: string;
  cancel: string;
  reasonPlaceholder: string;
  deleteConfirm: string;
  noGroups: string;
  noGroupsDescription: string;
  deleteTooltip: string;
  editTooltip: string;
}

export interface GroupListProps {
  groups: GroupWithPermissions[];
  permissionKeys: readonly string[];
  dict: GroupsDict;
}

export interface GroupFormData {
  name: string;
  description: string;
  permissionKeys: string[];
  reason: string;
}

export const EMPTY_FORM: GroupFormData = {
  name: '',
  description: '',
  permissionKeys: [],
  reason: '',
};
