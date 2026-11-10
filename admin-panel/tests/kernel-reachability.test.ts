import { describe, expect, it } from 'vitest';

import {
  classifyReachability,
  parseKernelSubsystem,
  SUBSYSTEM_MODULES,
  type HostModuleState,
  type Reachability,
} from '@/lib/security/kernel-reachability';

// What the production host reports: the blacklisted families, the modules it runs, the rest absent.
const HOST: HostModuleState = {
  ksmbd: 'blacklisted',
  ceph: 'blacklisted',
  libceph: 'blacklisted',
  nfsd: 'blacklisted',
  rpcrdma: 'blacklisted',
  rdma_rxe: 'blacklisted',
  siw: 'blacklisted',
  tipc: 'blacklisted',
  cifs: 'loaded',
  cfg80211: 'loaded',
  mac80211: 'loaded',
  amdgpu: 'loaded',
  snd: 'loaded',
  soundcore: 'loaded',
  bluetooth: 'absent',
  btusb: 'absent',
  kvm: 'absent',
  f2fs: 'absent',
  ntfs3: 'absent',
  ocfs2: 'absent',
  gcov: 'absent',
  enetc: 'absent',
  btrfs: 'absent',
  can: 'absent',
  can_raw: 'absent',
  media: 'absent',
  videodev: 'absent',
  spi_rockchip: 'absent',
  bpf: 'builtin',
  netfilter: 'builtin',
  sch_htb: 'builtin',
  ipv4: 'builtin',
  af_unix: 'builtin',
};

interface ParseCase {
  readonly title: string;
  readonly expected: string | null;
}

describe('parseKernelSubsystem', () => {
  const cases: readonly ParseCase[] = [
    { title: 'kernel: ksmbd: use-after-free in smb2_dump_detail', expected: 'ksmbd' },
    { title: 'kernel: wifi: cfg80211: heap overflow in scan', expected: 'wifi' },
    { title: 'kernel: bpf: out-of-bounds read in verifier', expected: 'bpf' },
    { title: 'kernel: netfilter: nf_tables: double free in nft_set', expected: 'netfilter' },
    { title: 'kernel: netfilter: nf_tables: nft_chain: double free', expected: 'netfilter' },
    { title: 'kernel: KVM: arm64: NULL deref in vgic', expected: 'KVM' },
    { title: 'kernel: fs/ntfs3: out-of-bounds write in attr', expected: 'fs/ntfs3' },
    { title: 'kernel: drm/amdkfd: race in kfd_ioctl', expected: 'drm/amdkfd' },
    { title: 'kernel: net/sched: use-after-free in qdisc_graft', expected: 'net/sched' },
    { title: 'kernel: Linux kernel: multiple vulnerabilities', expected: 'Linux kernel' },
    { title: 'kernel:  Bluetooth:  race in hci_conn', expected: 'Bluetooth' },
    { title: '  kernel: f2fs: denial of service in gc  ', expected: 'f2fs' },
    { title: 'kernel: Null pointer dereference and use after free in net/a', expected: null },
    { title: 'Kernel: race when faulting a device private page in memory m', expected: null },
    { title: 'kernel: OOB Access in smb2_dump_detail', expected: null },
    { title: 'kernel:ksmbd: no space after the prefix', expected: 'ksmbd' },
    { title: 'kernel: ksmbd:', expected: null },
    { title: '', expected: null },
    { title: 'CVE-2024-0001 in ksmbd', expected: null },
  ];

  it.each(cases)('parses "$title" as $expected', ({ title, expected }) => {
    expect(parseKernelSubsystem(title)).toBe(expected);
  });
});

interface ClassifyCase {
  readonly title: string;
  readonly expected: Reachability;
}

describe('classifyReachability', () => {
  const cases: readonly ClassifyCase[] = [
    { title: 'kernel: ksmbd: use-after-free in smb2_dump_detail', expected: 'unreachable' },
    { title: 'kernel: ksmbd: OOB Access in smb2_dump_detail', expected: 'unreachable' },
    { title: 'kernel: ceph: heap overflow in messenger', expected: 'unreachable' },
    { title: 'kernel: libceph: NULL deref in decode', expected: 'unreachable' },
    { title: 'kernel: nfsd: use-after-free in nfsd4_proc', expected: 'unreachable' },
    { title: 'kernel: rpcrdma: stack overflow in recv', expected: 'unreachable' },
    { title: 'kernel: rdma: use-after-free in rxe', expected: 'unreachable' },
    { title: 'kernel: tipc: race in tipc_node', expected: 'unreachable' },
    { title: 'kernel: KVM: arm64: NULL deref in vgic', expected: 'unreachable' },
    { title: 'kernel: Bluetooth: race in hci_conn', expected: 'unreachable' },
    { title: 'kernel: f2fs: denial of service in gc', expected: 'unreachable' },
    { title: 'kernel: fs/ntfs3: out-of-bounds write in attr', expected: 'unreachable' },
    { title: 'kernel: ocfs2: double free in dlm', expected: 'unreachable' },
    { title: 'kernel: wifi: cfg80211: heap overflow in scan', expected: 'reachable' },
    { title: 'kernel: smb: client: use-after-free in cifs_read', expected: 'reachable' },
    { title: 'kernel: drm/amdkfd: race in kfd_ioctl', expected: 'reachable' },
    { title: 'kernel: ALSA: use-after-free in snd_pcm', expected: 'reachable' },
    { title: 'kernel: bpf: out-of-bounds read in verifier', expected: 'reachable' },
    { title: 'kernel: net: use-after-free in skb', expected: 'reachable' },
    { title: 'kernel: netfilter: nf_tables: double free in nft_set', expected: 'reachable' },
    { title: 'kernel: net/sched: use-after-free in qdisc_graft', expected: 'reachable' },
    { title: 'kernel: ipv4: NULL deref in tcp_ack', expected: 'reachable' },
    { title: 'kernel: af_unix: race in unix_gc', expected: 'reachable' },
    { title: 'kernel: btrfs: double free in extent', expected: 'unreachable' },
    { title: 'kernel: can: race in raw_sendmsg', expected: 'unreachable' },
    { title: 'kernel: media: use-after-free in video_register', expected: 'unreachable' },
    { title: 'kernel: spi-rockchip: NULL deref in transfer', expected: 'unreachable' },
    { title: 'kernel: usb: use-after-free in usb_submit_urb', expected: 'reachable' },
    { title: 'kernel: scsi: OOB write in scsi_report_opcode', expected: 'reachable' },
    { title: 'kernel: Linux kernel: multiple vulnerabilities', expected: 'unknown' },
    { title: 'kernel: zram: use-after-free in zram_write', expected: 'unknown' },
    { title: 'kernel: Null pointer dereference and use after free in net/a', expected: 'unknown' },
    { title: 'Kernel: race when faulting a device private page in memory m', expected: 'unknown' },
    { title: 'kernel: OOB Access in smb2_dump_detail', expected: 'unknown' },
    { title: 'CVE-2024-0001 in ksmbd', expected: 'unknown' },
  ];

  it.each(cases)('classifies "$title" as $expected', ({ title, expected }) => {
    expect(classifyReachability(title, HOST)).toBe(expected);
  });

  it('reports unknown when the host never mentions the subsystem module', () => {
    expect(classifyReachability('kernel: f2fs: denial of service in gc', {})).toBe('unknown');
  });

  it('reports reachable when one of the subsystem modules is loaded', () => {
    const host: HostModuleState = { cfg80211: 'blacklisted', mac80211: 'loaded' };
    expect(classifyReachability('kernel: wifi: heap overflow in scan', host)).toBe('reachable');
  });

  it('ignores host state for a built-in subsystem', () => {
    expect(classifyReachability('kernel: bpf: out-of-bounds read', {})).toBe('reachable');
  });

  it('is a pure function of its two arguments', () => {
    const title = 'kernel: ksmbd: use-after-free';
    const first = classifyReachability(title, HOST);
    const second = classifyReachability(title, HOST);
    expect(second).toBe(first);
    expect(HOST.ksmbd).toBe('blacklisted');
  });
});

describe('SUBSYSTEM_MODULES', () => {
  const entries = Object.entries(SUBSYSTEM_MODULES);

  it.each(entries)('%s is a lowercase key with at least one module', (key, rule) => {
    expect(key).toBe(key.trim().toLowerCase());
    expect(rule.modules.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s names only plain module identifiers', (_key, rule) => {
    for (const name of rule.modules) expect(name).toMatch(/^[a-z0-9_]+$/);
  });

  it('answers the measured production tokens', () => {
    const measured = [
      'ksmbd', 'wifi', 'bpf', 'smb', 'net', 'Bluetooth', 'netfilter', 'KVM', 'f2fs',
      'fs/ntfs3', 'drm/amdkfd', 'ALSA', 'net/sched', 'ocfs2',
      'btrfs', 'can', 'usb', 'scsi', 'media', 'spi-rockchip',
    ];
    for (const token of measured) expect(SUBSYSTEM_MODULES[token.toLowerCase()]).toBeDefined();
  });
});
