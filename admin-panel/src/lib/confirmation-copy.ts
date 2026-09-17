/**
 * Copy for every confirmation dialog in the panel.
 *
 * Why a single module: the browser `confirm()` prompts described the same kind of action in
 * four different ways, so an admin could not tell a permanent deletion from a reversible edit.
 * Every gate now builds its copy with one of the builders below, which fixes the shape per kind:
 * a short question as the title plus one consequence line as the description.
 *
 * Why the builders take a dictionary: the sentences themselves live in `src/dictionaries`, so the
 * Thai locale reaches a dialog the user has to act on. `buildConfirmationCopy` binds every builder
 * to one dictionary, and `useConfirmationCopy` performs that binding for client components.
 */

import { interpolate } from '@/lib/interpolate';
import type { Dictionary } from '@/lib/dictionary';

export const CONFIRMATION_KINDS = ['destructive', 'recoverable', 'operational'] as const;

/**
 * destructive — the row is deleted for good, the panel offers no way back
 * recoverable — state change that an admin can change back afterwards
 * operational — affects running services or server-side processing, destroys nothing
 */
export type ConfirmationKind = (typeof CONFIRMATION_KINDS)[number];

/** A kind/description/label triple as stored in the dictionary. */
export type ConfirmationText = Dictionary['confirmations']['destructive'];

export type ConfirmationDictionary = Dictionary['confirmations'];

/** Nouns that complete 'Delete this …?', kept as keys so the noun is translated with the sentence. */
export type DestructiveNoun = keyof ConfirmationDictionary['nouns'];
export type RecalculateKind = keyof ConfirmationDictionary['recalculate']['types'];
export type RestartStackKey = keyof ConfirmationDictionary['restartStack']['labels'];
export type RebuildStackKey = keyof ConfirmationDictionary['rebuildStack']['labels'];

export interface ConfirmationRequest {
  kind: ConfirmationKind;
  title: string;
  description: string;
  confirmLabel: string;
}

/** Every confirmation the panel can ask, bound to one dictionary. */
export interface ConfirmationCopy {
  destructiveConfirm: (noun: DestructiveNoun) => ConfirmationRequest;
  removeParticipantConfirm: () => ConfirmationRequest;
  removeTaskFromContestConfirm: () => ConfirmationRequest;
  markTestUserConfirm: () => ConfirmationRequest;
  recalculateSubmissionConfirm: (type: RecalculateKind) => ConfirmationRequest;
  fullServerUpdateConfirm: () => ConfirmationRequest;
  restartStackConfirm: (stack: RestartStackKey) => ConfirmationRequest;
  pullImagesConfirm: () => ConfirmationRequest;
  rebuildStackConfirm: (stack: RebuildStackKey) => ConfirmationRequest;
  manualBackupConfirm: () => ConfirmationRequest;
}

function request(
  kind: ConfirmationKind,
  text: ConfirmationText,
  values: Record<string, string> = {},
): ConfirmationRequest {
  return {
    kind,
    title: interpolate(text.title, values),
    description: interpolate(text.description, values),
    confirmLabel: interpolate(text.confirmLabel, values),
  };
}

/** Binds the confirmation builders to one dictionary. */
export function buildConfirmationCopy(copy: ConfirmationDictionary): ConfirmationCopy {
  return {
    /**
     * Deletion of one record. `noun` completes both the question and the consequence, which is what
     * keeps 'Delete this team?' and 'Delete this admin?' reading identically.
     */
    destructiveConfirm: (noun) =>
      request('destructive', copy.destructive, { noun: copy.nouns[noun] }),

    /** Removing a participation destroys the participant's entry in the contest; it is a deletion too. */
    removeParticipantConfirm: () => request('destructive', copy.removeParticipant),

    /** Unassigns the task (contest_id = null); the task itself survives. */
    removeTaskFromContestConfirm: () => request('recoverable', copy.removeTaskFromContest),

    /** Writes the hidden and unrestricted flags, both of which stay editable in the participation settings. */
    markTestUserConfirm: () => request('recoverable', copy.markTestUser),

    recalculateSubmissionConfirm: (type) =>
      request('operational', copy.recalculate, { type: copy.recalculate.types[type] }),

    fullServerUpdateConfirm: () => request('operational', copy.fullServerUpdate),

    restartStackConfirm: (stack) =>
      request('operational', copy.restartStack, { label: copy.restartStack.labels[stack] }),

    pullImagesConfirm: () => request('operational', copy.pullImages),

    rebuildStackConfirm: (stack) =>
      request('operational', copy.rebuildStack, { label: copy.rebuildStack.labels[stack] }),

    manualBackupConfirm: () => request('operational', copy.manualBackup),
  };
}
