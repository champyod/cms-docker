import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// 44px touch-target guard: Button sizes are h-11/h-12 by design (see
// components/core/Button.tsx). Flag fixed sub-44px sizing tokens on <Button>
// classNames before they regress mobile tap targets. Scoped to <Button> only:
// badges/dots/skeletons/divs use fixed sizes legitimately, and native
// <button> uses the intentional min-h-11/sm:min-h-0 responsive pattern
// (44px touch, compact pointer) which this rule deliberately ignores.
// Identifiers/constants (e.g. TAB_BASE) are not statically matchable — those
// stay on code review.
const touchTargetGuard = {
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector:
          'JSXOpeningElement[name.name="Button"] Literal[value=/(^|[\\s"\'`])((sm|md|lg|xl|2xl|hover|focus|active|disabled):)*((size|h|w)-([0-9]|10))\\b/]',
        message:
          "Button className uses fixed sub-44px sizing (min 44px touch target: keep h-11+). Non-interactive fixed sizes (badges/dots/skeletons) are fine outside <Button>.",
      },
      {
        selector:
          'JSXOpeningElement[name.name="Button"] TemplateElement[value.raw=/(^|[\\s"\'`])((sm|md|lg|xl|2xl|hover|focus|active|disabled):)*((size|h|w)-([0-9]|10))\\b/]',
        message:
          "Button className uses fixed sub-44px sizing (min 44px touch target: keep h-11+). Non-interactive fixed sizes (badges/dots/skeletons) are fine outside <Button>.",
      },
      {
        selector:
          'JSXOpeningElement[name.name="Button"] JSXAttribute[name.name="size"] Literal[value="icon"]',
        message:
          'Button size="icon" is below the 44px touch-target minimum; use size "sm" (h-11) or larger.',
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  touchTargetGuard,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
