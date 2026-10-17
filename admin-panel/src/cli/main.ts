import { PANEL_USAGE, PanelUsageError, parsePanelCommand, runPanelCommand } from '@/cli/panel';

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
    process.stdout.write(`${await runPanelCommand(parsePanelCommand(argv))}\n`);
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
