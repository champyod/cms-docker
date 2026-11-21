/**
 * The running front's own verdict: which container serves the routes, how a staged include is proved
 * with its `nginx -t`, and how it is told to reload.
 *
 * WHY the staged config is a copy of the live one with one path redirected: `nginx -t` only ever
 * judges a whole configuration, so proving staged bytes means giving nginx the front's real vhosts
 * with the generated directory pointed somewhere else — never at the file the front is serving.
 */
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import util from 'util';

import { getRepoRoot } from '@/lib/repo-root';

import type { FrontRunner } from './exposure-apply';
import type { CertificateSpec } from './service-wiring-render';

const execFilePromise = util.promisify(execFile);

/** Where the front mounts `config/generated`, and the staging directory inside it. */
export const GENERATED_MOUNT = '/etc/nginx/generated';
export const STAGING_DIR_NAME = '.staging';
export const CONTAINER_STAGING_PATH = `${GENERATED_MOUNT}/${STAGING_DIR_NAME}`;

/** The container that serves generated routes, in the order a deployment is likely to have them. */
export const FRONT_CONTAINERS = ['grader-nginx-proxy', 'cms-nginx-contest'] as const;

const TEST_ROOT = '/tmp/cms-staged';

/**
 * Reproduces the front's configuration around the staged files and tests it.
 *
 * WHY the `grep` guards: a config that names no generated include would let `nginx -t` pass on the
 * live file, which is the opposite of the guarantee this exists to give — so the script fails loudly
 * instead of reporting a green test it never ran.
 */
export const STAGED_TEST_SCRIPT = `set -eu
S=${TEST_ROOT}
rm -rf "$S"
mkdir -p "$S/conf.d" "$S/generated"
cp -a ${GENERATED_MOUNT}/. "$S/generated/" 2>/dev/null || true
rm -rf "$S/generated/${STAGING_DIR_NAME}"
cp -a ${CONTAINER_STAGING_PATH}/. "$S/generated/" 2>/dev/null || true
cp -a /etc/nginx/conf.d/. "$S/conf.d/" 2>/dev/null || true
for f in "$S"/conf.d/*.conf; do
  [ -f "$f" ] || continue
  sed -i "s|${GENERATED_MOUNT}|$S/generated|g" "$f"
done
grep -q "$S/generated" "$S"/conf.d/*.conf || { echo "cms-apply: the front declares no generated include to stage" >&2; exit 3; }
sed "s|include[[:space:]]*\\/etc\\/nginx\\/conf.d\\/\\*\\.conf;|include $S/conf.d/*.conf;|" /etc/nginx/nginx.conf > "$S/nginx.conf"
grep -q "$S/conf.d" "$S/nginx.conf" || { echo "cms-apply: the front's main config could not be pointed at the staged vhosts" >&2; exit 3; }
nginx -t -c "$S/nginx.conf"`;

/** The artifacts the sync and the panel both write, under the repository the panel runs in. */
export function liveArtifactsDir(root: string = getRepoRoot()): string {
  return path.join(root, 'config/generated');
}

/** The first running front container, or null when none is up. */
export async function discoverFrontContainer(): Promise<string | null> {
  const { stdout } = await execFilePromise('docker', ['ps', '--format', '{{.Names}}']);
  const running = new Set(stdout.split('\n').map((name) => name.trim()));
  return FRONT_CONTAINERS.find((name) => running.has(name)) ?? null;
}

/** Runs one front verb, keeping nginx's own lines as the error a caller reports. */
async function runDocker(args: readonly string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFilePromise('docker', [...args]);
    return `${stdout}${stderr}`;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr;
    throw new Error(stderr === undefined || stderr.trim() === '' ? String(error) : stderr.trim());
  }
}

export function createFrontRunner(container: string): FrontRunner {
  return {
    testStagedConfig: (): Promise<string> => runDocker(['exec', container, 'sh', '-c', STAGED_TEST_SCRIPT]),
    reloadFront: (): Promise<string> => runDocker(['exec', container, 'nginx', '-s', 'reload']),
  };
}

const CERTIFICATE_LINE = /^[ \t]*ssl_certificate[ \t]+(\S+);/m;
const CERTIFICATE_KEY_LINE = /^[ \t]*ssl_certificate_key[ \t]+(\S+);/m;
const SSL_INCLUDE_LINE = /^[ \t]*include[ \t]+(\S*nginx-ssl\.conf);/m;
/** The files the front is already configured from, most specific first. */
const SERVED_CONFIG_FILES = ['config/generated/contest-routes.conf', 'config/grader.nginx.conf'] as const;

/**
 * The certificate the front is already serving, so a save re-renders with the same one.
 *
 * WHY the rendered config and not config.toml: the file nginx loads is the authority on its own
 * certificate path, and re-deriving the operator's fallback chain here would be a second copy of it.
 */
export async function readServedCertificate(root: string = getRepoRoot()): Promise<CertificateSpec | undefined> {
  for (const relative of SERVED_CONFIG_FILES) {
    const content = await fs.readFile(path.join(root, relative), 'utf8').catch(() => null);
    if (content === null) continue;
    const certificate = CERTIFICATE_LINE.exec(content)?.[1];
    const key = CERTIFICATE_KEY_LINE.exec(content)?.[1];
    if (certificate === undefined || key === undefined) continue;
    const sslInclude = SSL_INCLUDE_LINE.exec(content)?.[1];
    return sslInclude === undefined ? { certificate, key } : { certificate, key, sslInclude };
  }
  return undefined;
}
