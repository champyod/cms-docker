// Single place for g-chord keys — registry owns path/label, this map owns the key.
// Choosing a co-located map over adding a field to NavEntry keeps the registry focused on
// navigation structure and permissions, avoiding mixing keyboard-specific concerns into the
// shared navigation source.
export const NAV_CHORD_KEY_BY_PATH: ReadonlyMap<string, string> = new Map<string, string>([
  ['/', 'd'],
  ['/docs', 'b'],
  ['/search', 'f'],
  ['/contests', 'c'],
  ['/tasks', 't'],
  ['/submissions', 's'],
  ['/users', 'u'],
  ['/teams', 'm'],
  ['/deployments', 'p'],
  // Why: /permissions absorbed the admins and groups pages, so it keeps 'a' — the chord operators
  // already know for admin management — while 'g' stays the chord prefix and 'p' belongs to deployments.
  ['/permissions', 'a'],
  ['/audit', 'i'],
  ['/resources', 'r'],
  ['/containers', 'o'],
  ['/ranking', 'n'],
  ['/appearance', 'v'],
  ['/maintenance', 'w'],
  ['/settings', 'e'],
]);
