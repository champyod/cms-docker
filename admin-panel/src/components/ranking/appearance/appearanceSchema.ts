import type { AppearanceFields } from '@/app/actions/rankingAppearance';
import type { Dictionary } from '@/lib/dictionary';

type AppearanceCopy = Dictionary['ranking']['appearance'];

export type AppearanceFieldKind = 'text' | 'select' | 'checkbox' | 'json';

export interface AppearanceOption {
  readonly value: string;
  readonly label: string;
}

export interface AppearanceField {
  readonly name: keyof AppearanceFields;
  readonly label: string;
  readonly kind: AppearanceFieldKind;
  readonly hint?: string;
  readonly options?: readonly AppearanceOption[];
}

export interface AppearanceSection {
  readonly id: string;
  readonly title: string;
  readonly fields: readonly AppearanceField[];
}

export const ACCESS_MODE_PUBLIC = 'public';
export const ACCESS_MODE_PROTECTED = 'protected';

/**
 * The one declaration of what the appearance form edits. The page renders whatever these
 * sections describe, so a new setting is a data edit here rather than another control
 * written into the page.
 */
export function buildAppearanceSections(copy: AppearanceCopy): readonly AppearanceSection[] {
  return [
    {
      id: 'identity',
      title: copy.identitySection,
      fields: [
        { name: 'title', label: copy.titleField, kind: 'text' },
        { name: 'subtitle', label: copy.subtitleField, kind: 'text' },
        { name: 'organisation', label: copy.organisationField, kind: 'text' },
        {
          name: 'displayName',
          label: copy.displayNameField,
          hint: copy.displayNameHint,
          kind: 'text',
        },
      ],
    },
    {
      id: 'display',
      title: copy.displaySection,
      fields: [
        {
          name: 'accessMode',
          label: copy.accessField,
          kind: 'select',
          options: [
            { value: ACCESS_MODE_PUBLIC, label: copy.accessPublic },
            { value: ACCESS_MODE_PROTECTED, label: copy.accessProtected },
          ],
        },
        { name: 'showIdColumn', label: copy.showIdColumn, kind: 'checkbox' },
        { name: 'anonymous', label: copy.anonymousField, kind: 'checkbox' },
        { name: 'footerText', label: copy.footerField, kind: 'text' },
        { name: 'creditsText', label: copy.creditsField, kind: 'text' },
      ],
    },
    {
      id: 'advanced',
      title: copy.advancedSection,
      fields: [
        { name: 'theme', label: copy.themeField, hint: copy.themeHint, kind: 'json' },
        {
          name: 'scoreFormat',
          label: copy.scoreFormatField,
          hint: copy.scoreFormatHint,
          kind: 'json',
        },
        {
          name: 'perspectives',
          label: copy.perspectivesField,
          hint: copy.perspectivesHint,
          kind: 'json',
        },
      ],
    },
  ];
}
