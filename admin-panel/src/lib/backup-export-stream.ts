/**
 * Streaming one selective dump out of cms-monitor and into an HTTP response.
 *
 * The monitor runs `scripts/__backup.sh --stdout`, which points its own stdout at
 * stderr and keeps the dump on the inherited descriptor, so the archive arrives on
 * this child's stdout while every log line arrives on stderr. Nothing is written
 * to the backup tree: the browser download is the only copy.
 *
 * No Prisma and no filesystem. The docker process is injected, so the transport is
 * decidable without a container: what a caller has to see is which exits are
 * reported as a failure before anything is streamed, and which cannot be.
 */

import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

const MONITOR_CONTAINER = 'cms-monitor';
const MONITOR_BACKUP_SCRIPT = '/usr/local/bin/cms-backup.sh';
/**
 * Bounded so a chatty failure cannot grow this buffer without limit. Only the
 * tail is kept, which is where the reason a dump was refused is printed.
 */
const MAX_STDERR_CHARS = 8_000;

/** What the transport needs from a started process, so a test can supply its own. */
export interface DumpProcess {
  readonly stdout: Readable;
  readonly stderr: Readable;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnDump = (args: readonly string[]) => DumpProcess;

export type DumpStream =
  | { readonly ok: true; readonly body: ReadableStream<Uint8Array> }
  | { readonly ok: false; readonly error: string };

/** The argv that streams a selective dump; nothing retargets a root because nothing is archived. */
export function dumpArgv(tables: readonly string[], includeLargeObjects: boolean): readonly string[] {
  const args = ['exec', MONITOR_CONTAINER, 'bash', MONITOR_BACKUP_SCRIPT, '--tables', tables.join(','), '--stdout'];
  return includeLargeObjects ? [...args, '--large-objects'] : args;
}

const defaultSpawn: SpawnDump = (args) => spawn('docker', [...args], { stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Starts the dump and answers once it has produced its first byte, so a run that
 * cannot start at all — docker missing, the container down, a refused gate — is
 * reported as an error instead of as a download of zero bytes.
 *
 * A failure *after* the first byte cannot be reported the same way: the response
 * headers are already sent. That is the trade the streaming transport makes, and
 * the script's own note says so — a mid-stream failure leaves the caller with
 * truncated bytes and a non-zero exit, which is what marks the download
 * incomplete. Cancelling the response kills the process rather than letting it
 * dump into a socket nobody reads.
 */
export function openDumpStream(args: readonly string[], spawnDump: SpawnDump = defaultSpawn): Promise<DumpStream> {
  return new Promise((resolve) => {
    const child = spawnDump(args);
    let stderr = '';
    let settled = false;
    let ended = false;
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const buffered: Buffer[] = [];

    const describe = (): string => (stderr.trim().length > 0 ? stderr.trim() : 'The dump could not be started.');
    const settleFailure = (): void => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: describe() });
    };

    child.stderr.on('data', (...args: unknown[]) => {
      stderr = (stderr + String(args[0])).slice(-MAX_STDERR_CHARS);
    });

    const body = new ReadableStream<Uint8Array>({
      start(next) {
        controller = next;
        for (const chunk of buffered) next.enqueue(new Uint8Array(chunk));
        buffered.length = 0;
        if (ended) next.close();
      },
      cancel() {
        child.kill('SIGTERM');
      },
    });

    child.stdout.on('data', (...args: unknown[]) => {
      const chunk = args[0] as Buffer;
      if (controller === null) {
        buffered.push(chunk);
        return;
      }
      controller.enqueue(new Uint8Array(chunk));
    });
    child.stdout.on('end', () => {
      ended = true;
      controller?.close();
      settleFailure();
    });
    child.on('error', (...args: unknown[]) => {
      stderr = stderr.length > 0 ? stderr : String(args[0]);
      settleFailure();
      controller?.error(new Error(describe()));
    });
    child.on('close', () => {
      // Nothing streamed and the process is gone: whatever the exit code, there is no
      // dump to send, and leaving the answer unresolved would hang the request.
      settleFailure();
    });

    // The first byte is the signal that the dump is really running, so the answer
    // waits for it rather than for the process to be spawned.
    child.stdout.once('data', () => {
      if (settled) return;
      settled = true;
      resolve({ ok: true, body });
    });
  });
}
