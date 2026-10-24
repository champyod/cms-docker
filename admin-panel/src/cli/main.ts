import { PANEL_USAGE, PanelUsageError, parsePanelCommand, runPanelCommand } from '@/cli/panel';
import { SYSTEM_IDENTITIES, withActor } from '@/lib/db-actor';

/**
 * The process entry point for `./cms panel`.
 *
 * WHY the entry is its own file: the parser and the dispatch stay importable so the suite can
 * drive them without a process starting work, and only this file reads argv, prints and sets the
 * exit code.
 *
 * WHY the cwd is the panel package: bun resolves the `@/…` aliases from the panel's tsconfig and
 * loads `DATABASE_URL` from the panel's `.env`, which is the connection the panel itself dials.
 * The `scripts/__panel_action.sh` shim sets that cwd before it runs this file.
 */

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(`${PANEL_USAGE}\n`);
    process.exitCode = argv.length === 0 ? 2 : 0;
    return;
  }
  try {
    // WHY the whole command runs as system:cli: a panel command has no session — the operator is
    // whoever holds shell access to the host — so the audit row is filed under the seeded root admin
    // and the database identity is the named CLI one. Every query inside inherits it; without this
    // scope the fail-closed policies would return nothing and the command would report an empty
    // panel instead of an error.
    process.stdout.write(
      `${await withActor({ kind: 'system', name: SYSTEM_IDENTITIES.CLI }, () =>
        runPanelCommand(parsePanelCommand(argv)),
      )}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`cms panel: ${message}\n`);
    if (error instanceof PanelUsageError) {
      process.stderr.write(`${PANEL_USAGE}\n`);
      process.exitCode = 2;
      return;
    }
    process.exitCode = 1;
  }
}

void main();
