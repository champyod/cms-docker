import fs from "node:fs";
import path from "node:path";
import {
  BARE_CALL_RE,
  EXPORT_FN_RE,
  JS_KEYWORDS,
  MAP_KEY_RE,
  MEMBER_CALL_RE,
  NAMED_IMPORT_RE,
  SESSION_ONLY_RE,
  STAR_IMPORT_RE,
  SRC_DIR,
  toRel,
  type FileInfo,
  KEY_CALL_RE,
  HAS_EFFECTIVE_RE,
} from "./model";

export function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith("@/") && !spec.startsWith(".")) return null;
  const base = spec.startsWith("@/")
    ? path.join(SRC_DIR, spec.slice(2))
    : path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, path.join(base, "route.ts")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// Why a hand scanner: brace counting with regex breaks on braces inside
// strings, so string/comment spans are skipped character by character.
export function sliceBody(source: string, openIdx: number): string {
  let depth = 0;
  let i = openIdx;
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;
  for (; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] ?? "";
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote !== null) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(openIdx, i + 1);
    }
  }
  return source.slice(openIdx);
}

// Why paren-aware plus annotation skip: generic return types like
// Promise<Payload<{ ... }>> hold braces between the params and the body, so
// the body is the first "{" with every nesting depth at zero.
export function bodyFromMatch(source: string, parenIdx: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  let i = parenIdx;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null;
  let angle = 0;
  let round = 0;
  let square = 0;
  quote = null;
  let lineComment = false;
  let blockComment = false;
  for (i++; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] ?? "";
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && next === "/") {
      lineComment = true;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "<") angle++;
    else if (ch === ">") angle = Math.max(0, angle - 1);
    else if (ch === "(") round++;
    else if (ch === ")") round = Math.max(0, round - 1);
    else if (ch === "[") square++;
    else if (ch === "]") square = Math.max(0, square - 1);
    else if (ch === "{" && angle === 0 && round === 0 && square === 0) {
      return sliceBody(source, i);
    } else if (ch === ";" && angle === 0 && round === 0 && square === 0) {
      return null;
    }
  }
  return null;
}

export function collectKeys(body: string, actionPermissions: Map<string, string>): string[] {
  const keys = new Set<string>();
  for (const re of [KEY_CALL_RE, HAS_EFFECTIVE_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) !== null) keys.add(match[1]);
  }
  // Why: a mapped action reads its key through ACTION_PERMISSIONS, so without
  // resolving the reference the gate would vanish and the action read as ungated.
  MAP_KEY_RE.lastIndex = 0;
  let mapped: RegExpExecArray | null;
  while ((mapped = MAP_KEY_RE.exec(body)) !== null) {
    const key = actionPermissions.get(mapped[1]);
    if (key !== undefined) keys.add(key);
  }
  return [...keys];
}

// Why a dedicated reader: the map is a hand-maintained literal, so its entries
// have to be recovered for the scanner and for the drift test to compare an
// entry against the gate its action actually demands.
export function parseActionPermissions(abs: string): Map<string, string> {
  const source = fs.readFileSync(abs, "utf8");
  const assignIdx = source.search(/ACTION_PERMISSIONS\s*[:=]/);
  if (assignIdx < 0) return new Map();
  const openIdx = source.indexOf("{", assignIdx);
  if (openIdx < 0) return new Map();
  const body = sliceBody(source, openIdx);
  const entries = new Map<string, string>();
  const entryRe = /([A-Za-z_]\w*)\s*:\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(body)) !== null) entries.set(match[1], match[2]);
  return entries;
}

export function parseFile(abs: string, actionPermissions: Map<string, string>): FileInfo {
  const source = fs.readFileSync(abs, "utf8");
  const starAliases = new Map<string, string>();
  const namedImports = new Map<string, string>();
  STAR_IMPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STAR_IMPORT_RE.exec(source)) !== null) {
    const target = resolveImport(abs, match[2]);
    if (target !== null) starAliases.set(match[1], target);
  }
  NAMED_IMPORT_RE.lastIndex = 0;
  while ((match = NAMED_IMPORT_RE.exec(source)) !== null) {
    const target = resolveImport(abs, match[2]);
    if (target === null) continue;
    for (const part of match[1].split(",")) {
      const pair = part.trim().split(/\s+as\s+/);
      const orig = pair[0].trim();
      const local = (pair[1] ?? orig).trim();
      if (orig !== "" && local !== "") namedImports.set(local, `${target}#${orig}`);
    }
  }
  return parseFunctions(source, abs, starAliases, namedImports, actionPermissions);
}

function parseFunctions(
  source: string,
  abs: string,
  starAliases: Map<string, string>,
  namedImports: Map<string, string>,
  actionPermissions: Map<string, string>,
): FileInfo {
  const fns: FileInfo["fns"] = new Map();
  EXPORT_FN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPORT_FN_RE.exec(source)) !== null) {
    const name = match[1];
    if (fns.has(name)) continue;
    const body = bodyFromMatch(source, match.index + match[0].length - 1);
    if (body === null) continue;
    const callees = new Set<string>();
    MEMBER_CALL_RE.lastIndex = 0;
    let call: RegExpExecArray | null;
    while ((call = MEMBER_CALL_RE.exec(body)) !== null) {
      const aliasTarget = starAliases.get(call[1]);
      if (aliasTarget !== undefined) callees.add(`${aliasTarget}#${call[2]}`);
    }
    BARE_CALL_RE.lastIndex = 0;
    while ((call = BARE_CALL_RE.exec(body)) !== null) {
      const callee = call[1];
      if (JS_KEYWORDS.has(callee)) continue;
      const imported = namedImports.get(callee);
      callees.add(imported ?? `local#${callee}`);
    }
    fns.set(name, {
      body,
      keys: collectKeys(body, actionPermissions),
      sessionOnly: SESSION_ONLY_RE.test(body),
      callees: [...callees],
    });
  }
  return { rel: toRel(abs), source, fns, starAliases, namedImports };
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
