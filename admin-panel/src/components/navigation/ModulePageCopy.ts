/**
 * Presentation-only header copy shared by the module group layouts.
 *
 * Why a plain shape: the title and description are the only strings a module shell
 * renders above its child routes, and every value is resolved by the caller from
 * the dictionary — no component decides a label or a permission. The trail above
 * them is not here either: the page builds it with the shared breadcrumb builder
 * and passes it as its own prop.
 */
export interface ModulePageCopy {
  readonly title: string;
  readonly description: string;
}
