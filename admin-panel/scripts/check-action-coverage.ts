#!/usr/bin/env bun
/**
 * Fail when a server entry point is reachable without a permission gate,
 * or when it declares one key but reaches code demanding another (A->B seam).
 *
 * Why static text analysis instead of runtime tracing: no test fails today when
 * an ungated server action is added, so the check must enumerate TypeScript
 * entry points itself. It follows calls into lib/services/*, lib/deploy-store.ts
 * and lib/deploy-operations.ts because thin action wrappers delegate their
 * gating there; without that the wrappers would all read as ungated.
 *
 * Known limits (heuristic, not a proof): brace matching skips string/comment
 * spans but not ${} nesting inside template literals; callee resolution falls
 * back to name matching across files when an import alias cannot be resolved;
 * field-write detection (is_active, active_dataset_id) is textual. A finding is
 * evidence to confirm by reading, not a verdict on its own.
 *
 * Usage: bun admin-panel/scripts/check-action-coverage.ts [--json]
 */
import fs from "node:fs";
import path from "node:path";
import {
  ACTIONS_DIR,
  ALLOWLIST,
  API_DIR,
  FOLLOW_FILES,
  ROUTE_METHODS,
  SRC_DIR,
  toRel,
  type EntryPoint,
  type FileInfo,
  type Finding,
} from "./coverage/model";
import { parseFile } from "./coverage/scan";
import { isAllowlisted, listFilesRecursive, resolveDemanded, tableUpdateKeys } from "./coverage/resolve";

function collectEntries(
  files: Map<string, FileInfo>,
  actionFiles: string[],
  routeFiles: string[],
  tables: Map<string, string[]>,
): EntryPoint[] {
  const entries: EntryPoint[] = [];
  for (const abs of actionFiles) {
    const info = files.get(abs);
    if (info === undefined) continue;
    if (!info.source.includes("'use server'") && !info.source.includes('"use server"')) continue;
    for (const name of info.fns.keys()) {
      const exported = new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(`);
      if (!exported.test(info.source)) continue;
      const id = `${toRel(abs)}#${name}`;
      entries.push({
        id,
        file: toRel(abs),
        fn: name,
        directKeys: info.fns.get(name)?.keys ?? [],
        demanded: resolveDemanded(abs, name, files, tables),
        allowlisted: isAllowlisted(id) !== null,
      });
    }
  }
  for (const abs of routeFiles) {
    const info = files.get(abs);
    if (info === undefined) continue;
    for (const method of ROUTE_METHODS) {
      const handler = new RegExp(`export\\s+async\\s+function\\s+${method}\\s*\\(`);
      if (!handler.test(info.source)) continue;
      const id = `${toRel(abs)}#${method}`;
      entries.push({
        id,
        file: toRel(abs),
        fn: method,
        directKeys: info.fns.get(method)?.keys ?? [],
        demanded: resolveDemanded(abs, method, files, tables),
        allowlisted: isAllowlisted(id) !== null,
      });
    }
  }
  return entries;
}

function findViolations(entries: EntryPoint[]): Finding[] {
  const findings: Finding[] = [];
  for (const entry of entries) {
    if (entry.allowlisted) continue;
    if (entry.demanded.length === 0) {
      findings.push({ type: "ungated", entry: entry.id, declared: entry.directKeys, reached: [] });
      continue;
    }
    // Why the all:all carve-out: it is a superset grant, so reached keys add no
    // new restriction. Every other declared key must cover what it reaches.
    if (entry.directKeys.includes("all:all")) continue;
    const declared = new Set(entry.directKeys);
    const missing = entry.demanded.filter((key) => !declared.has(key));
    if (missing.length > 0 && entry.directKeys.length > 0) {
      findings.push({ type: "seam", entry: entry.id, declared: entry.directKeys, reached: missing });
    }
  }
  return findings;
}

function run(): { entries: EntryPoint[]; findings: Finding[] } {
  const actionFiles = listFilesRecursive(ACTIONS_DIR, ".ts").filter(
    (abs) => !abs.endsWith(".test.ts"),
  );
  const routeFiles = listFilesRecursive(API_DIR, "route.ts");
  const redirectFile = path.join(SRC_DIR, "lib", "redirect.ts");
  const watched = new Set<string>([...actionFiles, ...FOLLOW_FILES, ...routeFiles]);
  if (fs.existsSync(redirectFile)) watched.add(redirectFile);
  const files = new Map<string, FileInfo>();
  for (const abs of watched) files.set(abs, parseFile(abs));
  const fieldPerms = files.get(path.join(SRC_DIR, "lib", "field-permissions.ts"));
  const tables = fieldPerms === undefined ? new Map<string, string[]>() : tableUpdateKeys(fieldPerms.source);

  const entryFiles = fs.existsSync(redirectFile) ? [...actionFiles, redirectFile] : actionFiles;
  const entries = collectEntries(files, entryFiles, routeFiles, tables);
  return { entries, findings: findViolations(entries) };
}

function main(): void {
  const wantJson = process.argv.includes("--json");
  const { entries, findings } = run();
  if (wantJson) {
    process.stdout.write(`${JSON.stringify({ entries, findings, allowlist: ALLOWLIST }, null, 2)}\n`);
  } else {
    process.stdout.write(`entries: ${entries.length} findings: ${findings.length}\n`);
    for (const finding of findings) {
      const reached = finding.reached.join(",");
      process.stdout.write(
        `${finding.type} ${finding.entry} declared=[${finding.declared.join(",")}] reached=[${reached}]\n`,
      );
    }
    for (const entry of entries.filter((item) => item.allowlisted)) {
      const allow = isAllowlisted(entry.id);
      process.stdout.write(`allowlisted ${entry.id} reason=${allow?.reason ?? "unknown"}\n`);
    }
  }
  if (findings.length > 0) process.exit(1);
}

main();
