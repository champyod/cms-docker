/**
 * The one list of verbs each override target accepts.
 *
 * WHY one module: the form offers these verbs and the action refuses anything outside
 * them, so a second copy would let the picker offer a verb the server then rejects. A
 * task drops a board column and a ranking is the whole board, so neither can be renamed,
 * pinned or scored; every other target carries the full set.
 */
export const OVERRIDE_ACTIONS = ['hide', 'guest', 'pin', 'rename', 'score', 'freeze'] as const;
export type OverrideAction = (typeof OVERRIDE_ACTIONS)[number];

export const OVERRIDE_TARGETS = ['user', 'team', 'ranking', 'task'] as const;
export type OverrideTarget = (typeof OVERRIDE_TARGETS)[number];

export const KIND_VERBS: Readonly<Record<string, readonly string[]>> = {
  user: OVERRIDE_ACTIONS,
  team: OVERRIDE_ACTIONS,
  ranking: ['hide', 'freeze'],
  task: ['hide'],
};
