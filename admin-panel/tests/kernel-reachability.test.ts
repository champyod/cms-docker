import { describe, expect, it } from 'vitest';

import {
  classifyReachability,
  parseKernelSubsystem,
  SUBSYSTEM_MODULES,
  SUBSYSTEM_MODULE_NAMES,
  type HostModuleState,
  type Reachability,
} from '@/lib/security/kernel-reachability';
import { moduleStateMap } from '@/lib/security/host-module-state';

// A host that runs the desktop modules and blacklists the fleet's unused families; not the fleet itself.
// `PRODUCTION` below is the measured one.
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

// Measured on como-main, 2026-11-12: what /proc/modules listed and /etc/modprobe.d blacklisted,
// narrowed to the modules this table asks about. Every other name the table mentions is truly absent.
const PRODUCTION_LOADED = ['bridge', 'btrfs', 'ib_core', 'ksmbd', 'tls', 'vmwgfx', 'vsock'];
const PRODUCTION_BLOCKED = ['ceph', 'ksmbd', 'libceph', 'nfsd', 'rdma_rxe', 'rpcrdma', 'siw', 'tipc'];

const PRODUCTION: HostModuleState = moduleStateMap(SUBSYSTEM_MODULE_NAMES, {
  loaded: PRODUCTION_LOADED,
  blocked: PRODUCTION_BLOCKED,
});

interface MeasuredCase {
  readonly token: string;
  readonly title: string;
  readonly expected: Reachability;
}

// One real title per token the table gained, verbatim from security_findings: two carry an HTML
// entity from ingest and are kept as stored. A token is only here because its module can be named.
const MEASURED_TITLES: readonly MeasuredCase[] = [
    { token: 'ice', title: 'kernel: ice: always check VF VSI pointer values', expected: 'unreachable' },
    { token: 'rdma/mlx5', title: 'kernel: RDMA/mlx5: Release the HW&#8209;provided UAR index rather than the SW one', expected: 'unreachable' },
    { token: 'rdma/irdma', title: 'kernel: RDMA/irdma: Initialize free_qp completion before using it', expected: 'unreachable' },
    { token: 'iommu/amd', title: 'kernel: iommu/amd: Do not reallocate GA log buffers on resume', expected: 'reachable' },
    { token: 'iommu/vt-d', title: 'kernel: iommu/vt-d: Clear Present bit before tearing down context entry', expected: 'reachable' },
    { token: 'blk-mq', title: 'kernel: blk-mq: fix potential deadlock while nr_requests grown', expected: 'reachable' },
    { token: 'pci/sysfs', title: 'kernel: PCI/sysfs: Add CAP_SYS_ADMIN check to __resource_resize_store()', expected: 'reachable' },
    { token: 'cgroup/cpuset', title: 'kernel: cgroup/cpuset: Don\'t access cpuset_cgrp_subsys.root in is_in_v2_mode()', expected: 'reachable' },
    { token: 'drm/amd/display', title: 'kernel: drm/amd/display: add null check', expected: 'unreachable' },
    { token: 'spi', title: 'kernel: spi: lpspi: Avoid potential use-after-free in probe()', expected: 'reachable' },
    { token: 'asoc', title: 'kernel: ASoC: tas2562: Validate values for volume writes', expected: 'unreachable' },
    { token: 'ext4', title: 'kernel: ext4: fix e4b bitmap inconsistency reports', expected: 'reachable' },
    { token: 'net/mlx5e', title: 'kernel: net/mlx5e: Fix cleanup null-ptr deref on encap lock', expected: 'unreachable' },
    { token: 'pci', title: 'kernel: PCI: Avoid putting some root ports into D3 on TUXEDO Sirius Gen1', expected: 'reachable' },
    { token: 'crypto', title: 'kernel: crypto: atmel-sha204a - Fix potential UAF and memory leak in remove path', expected: 'reachable' },
    { token: 'iio', title: 'kernel: iio: imu: st_lsm6dsx: fix iio_chan_spec for sensors without event detection', expected: 'unreachable' },
    { token: 'dmaengine', title: 'kernel: dmaengine: xilinx_dma: Fix CPU stall in xilinx_dma_poll_timeout', expected: 'reachable' },
    { token: 'hid', title: 'kernel: HID: sony: clean up device list on probe failure', expected: 'unreachable' },
    { token: 'ipv6', title: 'kernel: ipv6: use RCU in ip6_xmit()', expected: 'reachable' },
    { token: 'tracing', title: 'kernel: tracing: Take trace_array reference when opening a tracer options file', expected: 'reachable' },
    { token: 'xfrm', title: 'kernel: xfrm: hold net_device reference under RCU in bundle creation', expected: 'reachable' },
    { token: 'fbdev', title: 'kernel: fbdev: Wrap user-invoked calls to fb_set_var() in helper', expected: 'reachable' },
    { token: 'net/mlx5', title: 'kernel: net/mlx5: Reload only IB representors upon lag disable/enable', expected: 'unreachable' },
    { token: 'net/smc', title: 'kernel: net/smc: protect link down work from execute after lgr freed', expected: 'unreachable' },
    { token: 'tty', title: 'kernel: tty: vcc: hold port lock when clearing tty pointer in vcc_cleanup', expected: 'reachable' },
    { token: 'namespace', title: 'kernel: namespace: check the mounts before reading their parents in pivot_root()', expected: 'reachable' },
    { token: 'serial', title: 'kernel: serial: core: clear freed pointers on uart_register_driver() failure', expected: 'reachable' },
    { token: 'gpio', title: 'kernel: gpio: mvebu: free generic chips on unbind', expected: 'reachable' },
    { token: 'hwmon', title: 'kernel: hwmon: (pwm-fan) Stop RPM timer before freeing tach data', expected: 'reachable' },
    { token: 'sunrpc', title: 'kernel: sunrpc: fix use-after-free in __rpc_clnt_handle_event and __rpc_clnt_remove_pipedir', expected: 'unreachable' },
    { token: 'acpi', title: 'kernel: ACPI: platform: Use acpi_bus_get_primary_device()', expected: 'reachable' },
    { token: 'erofs', title: 'kernel: erofs: handle overlapped pclusters out of crafted images properly', expected: 'unreachable' },
    { token: 'i3c', title: 'kernel: i3c: mipi-i3c-hci: Fix race in i3c_hci_addr_to_dev()', expected: 'unreachable' },
    { token: 'ipvs', title: 'kernel: ipvs: fix the checksum validations', expected: 'unreachable' },
    { token: 'md', title: 'kernel: md: Don\'t ignore read-only array in md_check_recovery()', expected: 'reachable' },
    { token: 'null_blk', title: 'kernel: null_blk: serialize configfs attribute updates with device setup', expected: 'unreachable' },
    { token: 'rxrpc', title: 'kernel: rxrpc: Fix recv-recv race of completed call', expected: 'unreachable' },
    { token: 'sctp', title: 'kernel: sctp: fix err_chunk memory leaks in INIT handling', expected: 'unreachable' },
    { token: 'vxlan', title: 'kernel: vxlan: use one headroom snapshot for neighbour replies', expected: 'unreachable' },
    { token: 'xfs', title: 'kernel: xfs: don&#39;t walk off the end of a directory data block', expected: 'unreachable' },
    { token: 'ax25', title: 'kernel: ax25: rcu protect dev->ax25_ptr', expected: 'unreachable' },
    { token: 'block', title: 'kernel: block: fix resource leak in blk_register_queue() error path', expected: 'reachable' },
    { token: 'bonding', title: 'kernel: bonding: fix type confusion in bond_setup_by_slave()', expected: 'unreachable' },
    { token: 'mmc', title: 'kernel: mmc: sdhci-sprd: disable runtime PM on remove', expected: 'reachable' },
    { token: 'mptcp', title: 'kernel: mptcp: plug races between subflow fail and subflow creation', expected: 'reachable' },
    { token: 'mtd', title: 'kernel: mtd: rawnand: cadence: Initialize IRQ state before requesting IRQ', expected: 'unreachable' },
    { token: 'nvme', title: 'kernel: nvme: validate FDP configuration descriptor sizes', expected: 'unreachable' },
    { token: 'rdma/core', title: 'kernel: RDMA/core: Fix potential use after free in counter_release()', expected: 'reachable' },
    { token: 'rdma/rxe', title: 'kernel: RDMA/rxe: Fix responder UAF on IB_QP_MAX_DEST_RD_ATOMIC modify_qp', expected: 'unreachable' },
    { token: 'smb/client', title: 'kernel: smb/client: validate new EOF for insert range', expected: 'unreachable' },
    { token: 'smb/server', title: 'kernel: smb/server: fix possible memory leak in smb2_read()', expected: 'reachable' },
    { token: 'svcrdma', title: 'kernel: svcrdma: Reject connection when transport allocation fails', expected: 'unreachable' },
    { token: 'apparmor', title: 'kernel: apparmor: fix deadlock in complain-mode change_hat', expected: 'reachable' },
    { token: 'clk', title: 'kernel: clk: mediatek: fix of_iomap memory leak', expected: 'reachable' },
    { token: 'drm/amd/pm', title: 'kernel: drm/amd/pm: fix a potential gpu_metrics_table memory leak', expected: 'unreachable' },
    { token: 'ntfs', title: 'kernel: ntfs: detect mapping-pairs LCN accumulator overflow', expected: 'unreachable' },
    { token: 'perf', title: 'kernel: perf: Require kernel access for text poke events', expected: 'reachable' },
    { token: 'selinux', title: 'kernel: selinux: preserve NATIVE_LABELS on already-initialized sb in set_mnt_opts', expected: 'reachable' },
    { token: 'tcp', title: 'kernel: tcp: clamp route advmss to TCP_MIN_MSS', expected: 'reachable' },
    { token: 'afs', title: 'kernel: afs: Fix missing NULL pointer check in afs_break_some_callbacks()', expected: 'unreachable' },
    { token: 'drm/amdgpu/vcn', title: 'kernel: drm/amdgpu/vcn: set no_user_fence for VCN v3.0 enc/dec rings', expected: 'unreachable' },
    { token: 'drm/vmwgfx', title: 'kernel: drm/vmwgfx: validate pitch coming from userspace', expected: 'reachable' },
    { token: 'exfat', title: 'kernel: exfat: add cluster chain loop check for dir', expected: 'unreachable' },
    { token: 'futex', title: 'kernel: futex: Prevent use-after-free during requeue-PI', expected: 'reachable' },
    { token: 'gfs2', title: 'kernel: gfs2: move quota_init qc iterator increment', expected: 'unreachable' },
    { token: 'input', title: 'kernel: Input: ims-pcu - fix race condition in reset_device sysfs callback', expected: 'reachable' },
    { token: 'kprobes', title: 'kernel: kprobes: Fix check for probe enabled in kill_kprobe()', expected: 'reachable' },
    { token: 'mailbox', title: 'kernel: mailbox: mtk-cmdq: Move devm_mbox_controller_register() after devm_pm_runtime_enable()', expected: 'reachable' },
    { token: 'mt76', title: 'kernel: mt76: mt7915: Fix PCI device refcount leak in mt7915_pci_init_hif2()', expected: 'unreachable' },
    { token: 'nbd', title: 'kernel: nbd: null check for nla_nest_start', expected: 'unreachable' },
    { token: 'nvmet', title: 'kernel: nvmet: move async event work off nvmet-wq', expected: 'unreachable' },
    { token: 'smb3', title: 'kernel: smb3: fix temporary data corruption in insert range', expected: 'unreachable' },
    { token: 'smc', title: 'kernel: smc: Fix use-after-free in tcp_write_timer_handler()', expected: 'unreachable' },
    { token: 'thunderbolt', title: 'kernel: thunderbolt: Fix NULL dereference in tb_remove_work()', expected: 'unreachable' },
    { token: 'drm/amdgpu/jpeg', title: 'kernel: drm/amdgpu/jpeg: set no_user_fence for JPEG v3.0 ring', expected: 'unreachable' },
    { token: 'drm/i915', title: 'kernel: drm/i915: Fix a memory leak with reused mmap_offset', expected: 'unreachable' },
    { token: 'ieee802154', title: 'kernel: ieee802154: Avoid calling WARN_ON() on -ENOMEM in cfg802154_switch_netns()', expected: 'unreachable' },
    { token: 'ipc', title: 'kernel: ipc: fix memory leak in init_mqueue_fs()', expected: 'reachable' },
    { token: 'keys', title: 'kernel: KEYS: Fix add_key() race with keyring restriction', expected: 'reachable' },
    { token: 'l2tp', title: 'kernel: l2tp: prevent possible tunnel refcount underflow', expected: 'unreachable' },
    { token: 'memstick', title: 'kernel: memstick: rtsx_usb_ms: complete requests after eject instead of dropping them', expected: 'unreachable' },
    { token: 'mm/hugetlb', title: 'kernel: mm/hugetlb: fix missing hugetlb_lock for resv uncharge', expected: 'reachable' },
    { token: 'net/packet', title: 'kernel: net/packet: guard the ll header push in packet_rcv_spkt()', expected: 'reachable' },
    { token: 'nvme-tcp', title: 'kernel: nvme-tcp: sanitize request list handling', expected: 'unreachable' },
    { token: 'pinctrl', title: 'kernel: pinctrl: mediatek: use devm_gpiochip_add_data() for GPIO chip', expected: 'reachable' },
    { token: 'tls', title: 'kernel: tls: get psock ref after taking rxlock to avoid leak', expected: 'reachable' },
    { token: 'watchdog', title: 'kernel: watchdog: at91sam9_wdt: prevent timer rearm during teardown', expected: 'reachable' },
    { token: 'x86/mce', title: 'kernel: x86/mce: Work around an erratum on fast string copy instructions', expected: 'reachable' },
    { token: 'zram', title: 'kernel: zram: fix out-of-bounds access in read_block_state()', expected: 'unreachable' },
    { token: 'cpufreq', title: 'kernel: cpufreq: amd-pstate: add check for cpufreq_cpu_get&#39;s return value', expected: 'reachable' },
    { token: 'io_uring', title: 'kernel: io_uring: check for overflows in io_pin_pages', expected: 'reachable' },
    { token: 'lockd', title: 'kernel: lockd: fix swapped arguments in nlmsvc_match_ip()', expected: 'unreachable' },
    { token: 'nfc', title: 'kernel: nfc: nci: complete pending data exchange on device close', expected: 'unreachable' },
    { token: 'nfs', title: 'kernel: nfs: use nfsi->rwsem to protect traversal of the file lock list', expected: 'unreachable' },
    { token: 'openvswitch', title: 'kernel: openvswitch: fix soft lockup in the netlink flow dump', expected: 'unreachable' },
    { token: 'regulator', title: 'kernel: regulator: ltc3676: don\'t read the write-only HRST and CLIRQ registers', expected: 'reachable' },
    { token: 'thermal', title: 'kernel: thermal: hwmon: Remove hwmon class device along with its parent', expected: 'reachable' },
    { token: 'udp', title: 'kernel: udp: Fix wildcard bind conflict check when using hash2', expected: 'reachable' },
    { token: 'vsock', title: 'kernel: vsock: treat TCP_CLOSING as once-established', expected: 'reachable' },
    { token: 'wireguard', title: 'kernel: wireguard: device: use exit_rtnl callback instead of manual rtnl_lock in pre_exit', expected: 'unreachable' },
    { token: 'bridge', title: 'kernel: bridge: cfm: Fix race condition in peer_mep deletion', expected: 'reachable' },
    { token: 'nfsv4', title: 'kernel: NFSv4: Fix incorrect argument passed to nfs4_delete_lease() in nfs4_add_lease()', expected: 'unreachable' },
];

describe('measured production tokens', () => {
  it.each(MEASURED_TITLES)('answers "$token" as $expected on the measured host', ({ title, expected }) => {
    expect(classifyReachability(title, PRODUCTION)).toBe(expected);
  });

  it.each(MEASURED_TITLES)('keys "$token" to a rule', ({ token }) => {
    expect(SUBSYSTEM_MODULES[token]).toBeDefined();
  });

  it('leaves a token with no nameable module unanswered', () => {
    // drm/msm is Qualcomm display code: no module of this host's tree carries it, so the table may
    // not claim the host lacks it either.
    expect(classifyReachability('kernel: drm/msm: fix a5xx preemption', PRODUCTION)).toBe('unknown');
  });
});
