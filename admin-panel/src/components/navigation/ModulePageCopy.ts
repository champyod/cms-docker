/**
 * Presentation-only header copy shared by the module group layouts.
 *
 * Why a plain shape: the group, title, and description are the only strings a
 * module shell renders above its child routes, and every value is resolved by the
 * caller from the dictionary — no component decides a label or a permission.
 */
export interface ModulePageCopy {
  readonly group: string;
  readonly title: string;
  readonly description: string;
}
