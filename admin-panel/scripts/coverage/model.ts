import path from "node:path";

export const PANEL_DIR = path.resolve(
  path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)),
  "..",
  "..",
);
export const SRC_DIR = path.join(PANEL_DIR, "src");
export const ACTIONS_DIR = path.join(SRC_DIR, "app", "actions");
export const API_DIR = path.join(SRC_DIR, "app", "api");
export const FOLLOW_FILES = [
  path.join(SRC_DIR, "lib", "services", "contests.ts"),
  path.join(SRC_DIR, "lib", "services", "tasks.ts"),
  path.join(SRC_DIR, "lib", "deploy-store.ts"),
  path.join(SRC_DIR, "lib", "deploy-operations.ts"),
  path.join(SRC_DIR, "lib", "field-permissions.ts"),
];

export const KEY_CALL_RE =
  /\b(?:ensurePermission|checkPermission|verifyApiPermission|requirePermission)\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
export const HAS_EFFECTIVE_RE =
  /\bhasEffectivePermission\s*\(\s*\w+\s*,\s*['"`]([^'"`]+)['"`]\s*\)/g;
export const SESSION_ONLY_RE = /\bverifyApiAuth\s*\(\s*\)/;
export const STRIP_FIELDS_RE = /\bstripDisallowedFields\s*\(\s*['"`]([^'"`]+)['"`]/g;
export const MEMBER_CALL_RE = /(\w+)\.(\w+)\s*\(/g;
export const BARE_CALL_RE = /(?<![\w$.])(\w+)\s*\(/g;
export const STAR_IMPORT_RE = /import\s+\*\s+as\s+(\w+)\s+from\s+['"`]([^'"`]+)['"`]/g;
export const NAMED_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*['"`]([^'"`]+)['"`]/g;
export const EXPORT_FN_RE = /(?:export\s+)?async\s+function\s+(\w+)\s*\(/g;
export const ROUTE_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const JS_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "return", "await", "async",
  "function", "new", "typeof", "throw", "else", "try", "finally",
]);

export interface AllowEntry {
  id: string;
  reason: string;
}

// Why each entry below is ungated by design: login/logout/captcha run before a
// session exists; getCurrentUser only reports the session; redirect only
// preserves locale in a path; getSubmissionFieldAccess returns static field
// metadata with no row data. The plan estimated 10 such surfaces; the six here
// are the ones with actual server entry points verified by reading.
export const ALLOWLIST: AllowEntry[] = [
  { id: "app/actions/auth.ts#login", reason: "Public login form: no session exists yet to authorize." },
  { id: "app/actions/auth.ts#logout", reason: "Session teardown: destroys the session instead of authorizing against it." },
  { id: "app/actions/auth.ts#getCaptchaState", reason: "Public captcha config: served before login so the form can render." },
  { id: "app/actions/auth.ts#getCurrentUser", reason: "Session-only read: returns the caller row, no permission key involved." },
  { id: "lib/redirect.ts#redirect", reason: "Redirect helper: preserves locale in a path, performs no data access." },
  { id: "app/actions/submissions.ts#getSubmissionFieldAccess", reason: "Static field metadata: describes columns, discloses no submission rows." },
];

export interface FnInfo {
  keys: string[];
  sessionOnly: boolean;
  callees: string[];
}

export interface FileInfo {
  rel: string;
  source: string;
  fns: Map<string, FnInfo>;
  starAliases: Map<string, string>;
  namedImports: Map<string, string>;
}

export interface EntryPoint {
  id: string;
  file: string;
  fn: string;
  directKeys: string[];
  demanded: string[];
  allowlisted: boolean;
}

export interface Finding {
  type: "ungated" | "seam";
  entry: string;
  declared: string[];
  reached: string[];
}

export function toRel(abs: string): string {
  return path.relative(PANEL_DIR, abs);
}
