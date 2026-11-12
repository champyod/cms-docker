// Kernel CVE reachability: does a finding's subsystem run on this host at all?
export type ModuleState = 'loaded' | 'builtin' | 'blacklisted' | 'absent';

// A module the host never mentioned is unanswered, not absent.
export type HostModuleState = Readonly<Record<string, ModuleState | undefined>>;

// The verdicts as a runtime list too, so a URL filter validates against the same three words.
export const REACHABILITY_VALUES = ['reachable', 'unreachable', 'unknown'] as const;

export type Reachability = (typeof REACHABILITY_VALUES)[number];

// A filter value is one of the three verdicts; anything else is a stale link, not a verdict.
export function isReachability(value: unknown): value is Reachability {
  return typeof value === 'string' && (REACHABILITY_VALUES as readonly string[]).includes(value);
}

export interface SubsystemRule {
  // Every module that carries the subsystem's code: one present module is enough.
  readonly modules: readonly string[];
  // Compiled into every supported kernel, so no host can lack the code path.
  readonly builtIn: boolean;
}

// Prefix is lower-case `kernel:` with a second `: `; titles outside that shape stay unparsed.
const KERNEL_TITLE = /^kernel:\s*([A-Za-z][A-Za-z0-9_./ +-]*?):\s+\S/;

// Keyed by the subsystem token of a measured production title, never by a plausible-looking guess:
// a token whose module cannot be named from the host's own facts stays out of this table, and its
// findings stay 'unknown'.
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
  btrfs: { modules: ['btrfs'], builtIn: false },
  can: { modules: ['can', 'can_raw'], builtIn: false },
  media: { modules: ['media', 'videodev'], builtIn: false },
  'spi-rockchip': { modules: ['spi_rockchip'], builtIn: false },
  bpf: { modules: ['bpf'], builtIn: true },
  net: { modules: ['net'], builtIn: true },
  netfilter: { modules: ['netfilter'], builtIn: true },
  'net/sched': { modules: ['sch_htb'], builtIn: true },
  ipv4: { modules: ['ipv4'], builtIn: true },
  af_unix: { modules: ['af_unix'], builtIn: true },
  // Built into the 5.15 generic kernel this fleet runs, so the code path exists whatever /proc/modules lists.
  usb: { modules: ['usbcore'], builtIn: true },
  scsi: { modules: ['scsi_mod', 'sd_mod'], builtIn: true },

  // Subsystems whose code this fleet's own rootfs carries as a module, measured 2026-11-12: each name
  // below is a .ko under /lib/modules/5.15.0-203-generic/kernel of the scanned host, so a 'blacklisted'
  // or 'absent' verdict here says something the host itself reported. Names are the loader's spelling
  // (dashes become underscores): snd-soc-core.ko is snd_soc_core, kafs.ko is the AFS client.
  'drm/amd/display': { modules: ['amdgpu'], builtIn: false },
  asoc: { modules: ['snd_soc_core'], builtIn: false },
  'net/mlx5e': { modules: ['mlx5_core'], builtIn: false },
  iio: { modules: ['industrialio'], builtIn: false },
  hid: { modules: ['hid'], builtIn: false },
  'net/mlx5': { modules: ['mlx5_core'], builtIn: false },
  'net/smc': { modules: ['smc'], builtIn: false },
  smb3: { modules: ['cifs'], builtIn: false },
  'smb/client': { modules: ['cifs'], builtIn: false },
  'smb/server': { modules: ['ksmbd'], builtIn: false },
  smc: { modules: ['smc'], builtIn: false },
  sunrpc: { modules: ['sunrpc'], builtIn: false },
  svcrdma: { modules: ['rpcrdma'], builtIn: false },
  'drm/amd/pm': { modules: ['amdgpu'], builtIn: false },
  xfs: { modules: ['xfs'], builtIn: false },
  ice: { modules: ['ice'], builtIn: false },
  'rdma/core': { modules: ['ib_core'], builtIn: false },
  'rdma/rxe': { modules: ['rdma_rxe'], builtIn: false },
  'rdma/mlx5': { modules: ['mlx5_ib'], builtIn: false },
  'rdma/irdma': { modules: ['irdma'], builtIn: false },
  rxrpc: { modules: ['rxrpc'], builtIn: false },
  vxlan: { modules: ['vxlan'], builtIn: false },
  erofs: { modules: ['erofs'], builtIn: false },
  sctp: { modules: ['sctp'], builtIn: false },
  null_blk: { modules: ['null_blk'], builtIn: false },
  i3c: { modules: ['i3c'], builtIn: false },
  ipvs: { modules: ['ip_vs'], builtIn: false },
  mtd: { modules: ['mtd'], builtIn: false },
  nvme: { modules: ['nvme'], builtIn: false },
  bonding: { modules: ['bonding'], builtIn: false },
  ax25: { modules: ['ax25'], builtIn: false },
  ntfs: { modules: ['ntfs'], builtIn: false },
  nfsv4: { modules: ['nfsv4'], builtIn: false },
  'drm/amdgpu/vcn': { modules: ['amdgpu'], builtIn: false },
  'drm/vmwgfx': { modules: ['vmwgfx'], builtIn: false },
  exfat: { modules: ['exfat'], builtIn: false },
  mt76: { modules: ['mt76'], builtIn: false },
  nvmet: { modules: ['nvmet'], builtIn: false },
  gfs2: { modules: ['gfs2'], builtIn: false },
  thunderbolt: { modules: ['thunderbolt'], builtIn: false },
  nbd: { modules: ['nbd'], builtIn: false },
  afs: { modules: ['kafs'], builtIn: false },
  'drm/amdgpu/jpeg': { modules: ['amdgpu'], builtIn: false },
  ieee802154: { modules: ['ieee802154', 'ieee802154_socket'], builtIn: false },
  zram: { modules: ['zram'], builtIn: false },
  'nvme-tcp': { modules: ['nvme_tcp'], builtIn: false },
  memstick: { modules: ['memstick'], builtIn: false },
  tls: { modules: ['tls'], builtIn: false },
  l2tp: { modules: ['l2tp_core', 'l2tp_eth'], builtIn: false },
  'drm/i915': { modules: ['i915'], builtIn: false },
  bridge: { modules: ['bridge'], builtIn: false },
  openvswitch: { modules: ['openvswitch'], builtIn: false },
  wireguard: { modules: ['wireguard'], builtIn: false },
  nfc: { modules: ['nfc'], builtIn: false },
  vsock: { modules: ['vsock'], builtIn: false },
  nfs: { modules: ['nfs'], builtIn: false },
  lockd: { modules: ['lockd'], builtIn: false },

  // Subsystems whose core is compiled into the same kernel (/boot/config-5.15.0-203-generic), so the
  // code path exists on every host of this fleet whatever /proc/modules lists; the symbol is named
  // per entry. A token is only here when the host's own config names the core it stands for.
  spi: { modules: ['spi'], builtIn: true }, // CONFIG_SPI=y
  ext4: { modules: ['ext4'], builtIn: true }, // CONFIG_EXT4_FS=y
  pci: { modules: ['pci'], builtIn: true }, // CONFIG_PCI=y
  crypto: { modules: ['crypto'], builtIn: true }, // CONFIG_CRYPTO=y
  dmaengine: { modules: ['dmaengine'], builtIn: true }, // CONFIG_DMADEVICES=y
  ipv6: { modules: ['ipv6'], builtIn: true }, // CONFIG_IPV6=y
  tracing: { modules: ['tracing'], builtIn: true }, // CONFIG_TRACING=y
  xfrm: { modules: ['xfrm'], builtIn: true }, // CONFIG_XFRM=y
  'net/packet': { modules: ['packet'], builtIn: true }, // CONFIG_PACKET=y
  tty: { modules: ['tty'], builtIn: true }, // CONFIG_TTY=y
  namespace: { modules: ['namespace'], builtIn: true }, // CONFIG_NAMESPACES=y
  serial: { modules: ['serial'], builtIn: true }, // CONFIG_SERIAL_8250=y
  hwmon: { modules: ['hwmon'], builtIn: true }, // CONFIG_HWMON=y
  gpio: { modules: ['gpio'], builtIn: true }, // CONFIG_GPIOLIB=y
  md: { modules: ['md'], builtIn: true }, // CONFIG_MD=y
  acpi: { modules: ['acpi'], builtIn: true }, // CONFIG_ACPI=y
  cpufreq: { modules: ['cpufreq'], builtIn: true }, // CONFIG_CPU_FREQ=y
  thermal: { modules: ['thermal'], builtIn: true }, // CONFIG_THERMAL=y
  regulator: { modules: ['regulator'], builtIn: true }, // CONFIG_REGULATOR=y
  pinctrl: { modules: ['pinctrl'], builtIn: true }, // CONFIG_PINCTRL=y
  mmc: { modules: ['mmc'], builtIn: true }, // CONFIG_MMC=y
  input: { modules: ['input'], builtIn: true }, // CONFIG_INPUT=y
  watchdog: { modules: ['watchdog'], builtIn: true }, // CONFIG_WATCHDOG=y
  fbdev: { modules: ['fbdev'], builtIn: true }, // CONFIG_FB=y
  mptcp: { modules: ['mptcp'], builtIn: true }, // CONFIG_MPTCP=y
  block: { modules: ['block'], builtIn: true }, // CONFIG_BLOCK=y
  'blk-mq': { modules: ['blk_mq'], builtIn: true }, // CONFIG_BLOCK=y (block/blk-mq.c)
  io_uring: { modules: ['io_uring'], builtIn: true }, // CONFIG_IO_URING=y
  mailbox: { modules: ['mailbox'], builtIn: true }, // CONFIG_MAILBOX=y
  clk: { modules: ['clk'], builtIn: true }, // CONFIG_COMMON_CLK=y
  keys: { modules: ['keys'], builtIn: true }, // CONFIG_KEYS=y
  futex: { modules: ['futex'], builtIn: true }, // CONFIG_FUTEX=y
  kprobes: { modules: ['kprobes'], builtIn: true }, // CONFIG_KPROBES=y
  perf: { modules: ['perf'], builtIn: true }, // CONFIG_PERF_EVENTS=y
  selinux: { modules: ['selinux'], builtIn: true }, // CONFIG_SECURITY_SELINUX=y
  apparmor: { modules: ['apparmor'], builtIn: true }, // CONFIG_SECURITY_APPARMOR=y
  ipc: { modules: ['ipc'], builtIn: true }, // CONFIG_SYSVIPC=y
  'cgroup/cpuset': { modules: ['cpuset'], builtIn: true }, // CONFIG_CGROUPS=y
  'pci/sysfs': { modules: ['pci_sysfs'], builtIn: true }, // CONFIG_PCI=y
  'iommu/amd': { modules: ['iommu_amd'], builtIn: true }, // CONFIG_AMD_IOMMU=y
  'iommu/vt-d': { modules: ['iommu_vtd'], builtIn: true }, // CONFIG_INTEL_IOMMU=y
  'x86/mce': { modules: ['mce'], builtIn: true }, // CONFIG_X86_MCE=y
  'mm/hugetlb': { modules: ['hugetlb'], builtIn: true }, // CONFIG_HUGETLB_PAGE=y
  tcp: { modules: ['tcp'], builtIn: true }, // CONFIG_INET=y
  udp: { modules: ['udp'], builtIn: true }, // CONFIG_INET=y
};

// The subsystem token of "kernel: <subsystem>: <description>", or null when the title is not that shape.
export function parseKernelSubsystem(title: string): string | null {
  const match = KERNEL_TITLE.exec(title.trim());
  return match === null ? null : match[1].trim();
}

// Every module any rule names, so `moduleStateMap` answers for all of them rather than leaving them undefined.
export const SUBSYSTEM_MODULE_NAMES: readonly string[] = [
  ...new Set(Object.values(SUBSYSTEM_MODULES).flatMap((rule) => rule.modules)),
];

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
