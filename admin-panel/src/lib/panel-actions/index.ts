/**
 * The panel's write semantics, callable in-process.
 *
 * WHY a module and not the server actions themselves: every one of these writes has to be
 * reachable both from the panel and from `./cms` while no panel server is up, and it has to be the
 * same write either way. The panel's server actions are thin wrappers over these functions — they
 * add the permission check, the session actor and the screen refresh — and the CLI's entry point
 * calls the same functions with the `root` actor. Nothing here reads a request, talks HTTP or
 * imports a request-time Next API, so a plain `bun` process can run it.
 */
export {
  bindServiceContest,
  removeExposure,
  removeService,
  removeWiring,
  saveExposure,
  saveService,
  saveWiring,
  validateExposure,
  validateService,
  type ServiceBinding,
} from './registry';
export { endConfigTargets, showConfigTarget, type ShownTargetInput } from './ranking-config';
export { addOverride, addOverrides, endOverrides, type OverrideInput } from './ranking-overrides';
export {
  assignTeamToParticipants,
  rotateContestAccounts,
  writeContestUsername,
  type ContestUsernameWrite,
  type RotateAccountsInput,
  type RotateAccountsResult,
} from './contest-accounts';
export {
  attachContestTask,
  attachContestTasks,
  detachContestTask,
  detachContestTasks,
  type ContestTaskSelection,
} from './contest-tasks';
export { resolveRootActorId } from './root-actor';
