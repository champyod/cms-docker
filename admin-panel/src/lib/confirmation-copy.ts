/**
 * Copy for every confirmation dialog in the panel.
 *
 * Why a single module: the browser `confirm()` prompts described the same kind of action in
 * four different ways, so an admin could not tell a permanent deletion from a reversible edit.
 * Every gate now builds its copy with one of the builders below, which fixes the shape per kind:
 * a short question as the title plus one consequence line as the description.
 */

export const CONFIRMATION_KINDS = ['destructive', 'recoverable', 'operational'] as const;

/**
 * destructive — the row is deleted for good, the panel offers no way back
 * recoverable — state change that an admin can change back afterwards
 * operational — affects running services or server-side processing, destroys nothing
 */
export type ConfirmationKind = (typeof CONFIRMATION_KINDS)[number];

export interface ConfirmationRequest {
  kind: ConfirmationKind;
  title: string;
  description: string;
  confirmLabel: string;
}

/** The one sentence every irreversible confirmation must end with. */
export const IRREVERSIBLE_CONSEQUENCE = 'This cannot be undone.';

export type RecalculateKind = 'score' | 'evaluation' | 'full';

/**
 * Deletion of one record. `noun` completes both the question and the consequence, which is what
 * keeps 'Delete this team?' and 'Delete this admin?' reading identically.
 */
export function destructiveConfirm(noun: string): ConfirmationRequest {
  return {
    kind: 'destructive',
    title: `Delete this ${noun}?`,
    description: `This permanently deletes the ${noun}. ${IRREVERSIBLE_CONSEQUENCE}`,
    confirmLabel: `Delete ${noun}`,
  };
}

/** Removing a participation destroys the participant's entry in the contest; it is a deletion too. */
export function removeParticipantConfirm(): ConfirmationRequest {
  return {
    kind: 'destructive',
    title: 'Remove this participant?',
    description: `This permanently removes the participant's entry from this contest. ${IRREVERSIBLE_CONSEQUENCE}`,
    confirmLabel: 'Remove participant',
  };
}

/** Unassigns the task (contest_id = null); the task itself survives. */
export function removeTaskFromContestConfirm(): ConfirmationRequest {
  return {
    kind: 'recoverable',
    title: 'Remove this task from the contest?',
    description: 'The task is unassigned and is not deleted; it can be added to the contest again.',
    confirmLabel: 'Remove task',
  };
}

/** Writes the hidden and unrestricted flags, both of which stay editable in the participation settings. */
export function markTestUserConfirm(): ConfirmationRequest {
  return {
    kind: 'recoverable',
    title: 'Mark this user as a test user?',
    description:
      'The participant becomes hidden and unrestricted. Both flags can be changed back in the participation settings.',
    confirmLabel: 'Mark as test user',
  };
}

export function recalculateSubmissionConfirm(type: RecalculateKind): ConfirmationRequest {
  return {
    kind: 'operational',
    title: `Recalculate this submission (${type})?`,
    description: 'Current results are cleared and recomputed from the submission, which is kept.',
    confirmLabel: 'Recalculate',
  };
}

export function fullServerUpdateConfirm(): ConfirmationRequest {
  return {
    kind: 'operational',
    title: 'Run a full server update?',
    description:
      'This pulls the latest images, restarts all services and updates the database schema. The server is unavailable for a few minutes.',
    confirmLabel: 'Run update',
  };
}

export function restartStackConfirm(label: string): ConfirmationRequest {
  return {
    kind: 'operational',
    title: `Restart ${label}?`,
    description: 'The affected services restart and are unavailable until they come back up.',
    confirmLabel: 'Restart',
  };
}

export function pullImagesConfirm(): ConfirmationRequest {
  return {
    kind: 'operational',
    title: 'Pull the latest images?',
    description:
      'Images are downloaded from the registry without restarting the running services. This may take several minutes.',
    confirmLabel: 'Pull images',
  };
}

export function rebuildStackConfirm(label: string): ConfirmationRequest {
  return {
    kind: 'operational',
    title: `Rebuild ${label} images from source?`,
    description:
      'Images are rebuilt from the current source without restarting the running services. This may take 5-10 minutes.',
    confirmLabel: 'Rebuild images',
  };
}

export function manualBackupConfirm(): ConfirmationRequest {
  return {
    kind: 'operational',
    title: 'Trigger a manual backup now?',
    description: 'All submissions are backed up in the background; the server keeps running.',
    confirmLabel: 'Trigger backup',
  };
}
