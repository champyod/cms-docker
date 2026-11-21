/** The control capabilities of the signed-in admin, resolved on the server from their effective keys. */
export interface AdminCapabilities {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canSetPassword: boolean;
  canRevealPassword: boolean;
}
