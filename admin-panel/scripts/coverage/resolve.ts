import fs from "node:fs";
import path from "node:path";
import { ALLOWLIST, STRIP_FIELDS_RE, type AllowEntry, type FileInfo } from "./model";
import { bodyFromMatch, sliceBody } from "./scan";

export function tableUpdateKeys(fieldPermSource: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  const tableRe = /^  (\w+): \{$/gm;
  let match: RegExpExecArray | null;
  while ((match = tableRe.exec(fieldPermSource)) !== null) {
    const openIdx = fieldPermSource.indexOf("{", match.index);
    const body = sliceBody(fieldPermSource, openIdx);
    const keys: string[] = [];
    const updateRe = /update:\s*'([^']+)'/g;
    let found: RegExpExecArray | null;
    while ((found = updateRe.exec(body)) !== null) keys.push(found[1]);
    tables.set(match[1], [...new Set(keys)]);
  }
  return tables;
}

export function listFilesRecursive(dir: string, suffix: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(abs, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) out.push(abs);
  }
  return out;
}

export function findByName(files: Map<string, FileInfo>, name: string): string[] {
  const hits: string[] = [];
  for (const [abs, info] of files) {
    if (info.fns.has(name)) hits.push(`${abs}#${name}`);
  }
  return hits;
}

// Why name fallback: barrel re-exports (export *) and dynamic dispatches do
// not always resolve through imports, so an unresolvable name is looked up by
// name across watched files instead of being silently dropped.
export function resolveTargets(
  scopeFile: string,
  rawCallee: string,
  files: Map<string, FileInfo>,
): string[] {
  const [scope, name] = rawCallee.split("#") as [string, string];
  if (scope !== "local") {
    if (files.get(scope)?.fns.has(name) === true) return [rawCallee];
    return findByName(files, name);
  }
  const sameFile = files.get(scopeFile);
  if (sameFile?.fns.has(name) === true) return [`${scopeFile}#${name}`];
  return findByName(files, name);
}

// Why textual field mapping: updateContest declares contest:update but a row
// carrying is_active demands contest:switch, and stripping it silently is the
// reported failure mode. The checker must see those keys as demanded. Only
// writes count: a comparison such as active_dataset_id === id reads the field.
export function impliedFieldKeys(body: string, tables: Map<string, string[]>): string[] {
  const keys = new Set<string>();
  STRIP_FIELDS_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STRIP_FIELDS_RE.exec(body)) !== null) {
    for (const key of tables.get(match[1]) ?? []) keys.add(key);
  }
  if (/\bis_active\b\s*[:=]\s*[^=]/.test(body)) keys.add("contest:switch");
  if (/\bactive_dataset_id\b\s*[:=]\s*[^=]/.test(body)) keys.add("dataset:switch");
  return [...keys];
}

export function fnBodyOf(file: string, fn: string): string {
  const source = fs.readFileSync(file, "utf8");
  const re = new RegExp(`(?:export\\s+)?async\\s+function\\s+${fn}\\s*\\(`);
  const found = re.exec(source);
  if (found === null) return "";
  const body = bodyFromMatch(source, found.index + found[0].length - 1);
  return body ?? "";
}

export function resolveDemanded(
  entryFile: string,
  entryFn: string,
  files: Map<string, FileInfo>,
  tables: Map<string, string[]>,
): string[] {
  const demanded = new Set<string>();
  const visited = new Set<string>();
  if (files.get(entryFile)?.fns.get(entryFn) === undefined) return [];
  const stack: string[] = [`${entryFile}#${entryFn}`];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (visited.has(current)) continue;
    visited.add(current);
    const [file, fn] = current.split("#") as [string, string];
    const info = files.get(file)?.fns.get(fn);
    if (info === undefined) continue;
    for (const key of info.keys) demanded.add(key);
    for (const key of impliedFieldKeys(fnBodyOf(file, fn), tables)) demanded.add(key);
    for (const raw of info.callees) {
      for (const target of resolveTargets(file, raw, files)) stack.push(target);
    }
  }
  return [...demanded];
}

export function isAllowlisted(id: string): AllowEntry | null {
  for (const allow of ALLOWLIST) {
    if (id === allow.id || id.endsWith(`/${allow.id}`)) return allow;
  }
  return null;
}
