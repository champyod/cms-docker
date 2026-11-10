// Kernel CVE reachability: does a finding's subsystem run on this host at all?
export type ModuleState = 'loaded' | 'builtin' | 'blacklisted' | 'absent';

// A module the host never mentioned is unanswered, not absent.
export type HostModuleState = Readonly<Record<string, ModuleState | undefined>>;

export type Reachability = 'reachable' | 'unreachable' | 'unknown';

export interface SubsystemRule {
  // Every module that carries the subsystem's code: one present module is enough.
  readonly modules: readonly string[];
  // Compiled into every supported kernel, so no host can lack the code path.
  readonly builtIn: boolean;
}

// Prefix is lower-case `kernel:` with a second `: `; titles outside that shape stay unparsed.
const KERNEL_TITLE = /^kernel:\s*([A-Za-z][A-Za-z0-9_./ +-]*?):\s+\S/;

// The measured production tokens, plus the families this host blacklists outright.
export const SUBSYSTEM_MODULES: Readonly<Record<string, SubsystemRule>> = {
  ksmbd: { modules: ['ksmbd'], builtIn: false },
  smb: { modules: ['cifs'], builtIn: false },
  cifs: { modules: ['cifs'], builtIn: false },
  wifi: { modules: ['cfg80211', 'mac80211'], builtIn: false },
  bluetooth: { modules: ['bluetooth', 'btusb'], builtIn: false },
  kvm: { modules: ['kvm'], builtIn: false },
  f2fs: { modules: ['f2fs'], builtIn: false },
  'fs/ntfs3': { modules: ['ntfs3'], builtIn: false },
  ntfs3: { modules: ['ntfs3'], builtIn: false },
  'drm/amdkfd': { modules: ['amdgpu'], builtIn: false },
  'drm/amdgpu': { modules: ['amdgpu'], builtIn: false },
  alsa: { modules: ['snd', 'soundcore'], builtIn: false },
  ocfs2: { modules: ['ocfs2'], builtIn: false },
  ceph: { modules: ['ceph', 'libceph'], builtIn: false },
  libceph: { modules: ['libceph'], builtIn: false },
  nfsd: { modules: ['nfsd'], builtIn: false },
  rpcrdma: { modules: ['rpcrdma'], builtIn: false },
  rdma: { modules: ['rdma_rxe', 'siw'], builtIn: false },
  tipc: { modules: ['tipc'], builtIn: false },
  gcov: { modules: ['gcov'], builtIn: false },
  enetc: { modules: ['enetc'], builtIn: false },
  bpf: { modules: ['bpf'], builtIn: true },
  net: { modules: ['net'], builtIn: true },
  netfilter: { modules: ['netfilter'], builtIn: true },
  'net/sched': { modules: ['sch_htb'], builtIn: true },
  ipv4: { modules: ['ipv4'], builtIn: true },
  af_unix: { modules: ['af_unix'], builtIn: true },
};

// The subsystem token of "kernel: <subsystem>: <description>", or null when the title is not that shape.
export function parseKernelSubsystem(title: string): string | null {
  const match = KERNEL_TITLE.exec(title.trim());
  return match === null ? null : match[1].trim();
}

// Any loaded module makes the subsystem reachable; an unmentioned one leaves the answer open.
function classifyModules(modules: readonly string[], host: HostModuleState): Reachability {
  let unanswered = false;
  for (const name of modules) {
    const state = host[name];
    if (state === 'loaded' || state === 'builtin') return 'reachable';
    if (state === undefined) unanswered = true;
  }
  return unanswered ? 'unknown' : 'unreachable';
}

// Three-valued on purpose: a host fact this table cannot answer is 'unknown', never a guess.
export function classifyReachability(title: string, host: HostModuleState): Reachability {
  const subsystem = parseKernelSubsystem(title);
  if (subsystem === null) return 'unknown';
  const rule = SUBSYSTEM_MODULES[subsystem.toLowerCase()];
  if (rule === undefined) return 'unknown';
  if (rule.builtIn) return 'reachable';
  return classifyModules(rule.modules, host);
}
