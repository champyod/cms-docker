'use client';

/**
 * Why this module is a re-export now: the shared LimitField is a core component, and the core
 * boundary test forbids core from importing a feature folder, so the one definition of the field
 * look lives at `@/components/core/fieldStyles` and the contestants that already import this path
 * keep working unchanged.
 */
export {
  ErrorText,
  FIELD_BASE,
  FIELD_ERROR,
  LABEL_CLASSES,
  fieldClasses,
} from '@/components/core/fieldStyles';
