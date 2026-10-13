Report 2026-10-07 — monitor Discord "🟢 up" flood จาก `event=start` ไม่ถูก suppress

```
HEAD: ddc2196 refactor(update_engine): reorganize database configuration variables
branch: major/admin-panel
tree: cms-docker-major-fix (worktree)
file: scripts/__monitor.sh
```

---

**[BUG-F] `collect_docker_event` ไม่ suppress `event=start` — ทุก container start สร้าง "🟢 up" alert**

repro

```
# stack ปกติ boot ขึ้นมา (หรือ restart ทุก service)
$ docker compose up -d
# monitor ฟัง docker events อยู่ → ทุก container ส่ง "🟢 up" message
# → Discord channel เต็มด้วย "🟢 up" N messages (N = จำนวน containers)
```

symptom ที่ operator เห็น

```
Discord channel:
  🟢 up cms-database
  🟢 up cms-log-service
  🟢 up cms-resource-service
  🟢 up cms-evaluation-service
  ... (ทุก container ใน stack)
  🟢 up cms-monitor
```

cause

```
scripts/__monitor.sh:

  482  docker events --filter 'event=start' --filter 'event=stop' ...
       → listen_docker_events() ฟัง event=start ด้วย

  379  collect_docker_event() {
  387    if should_suppress_notification "$cont_name" "$event_type"; then
  388      return 0
  389    fi
  390    # ← ไม่มี check สำหรับ event=start เลย
  398    rank=0; color=65280; emoji="🟢"; status="up"   ← default case
  424    printf '...' >> "$batch_file"                    ← เพิ่มเข้า batch
  }

  286  should_suppress_notification() {
  311    if [ "$auto_restart" = "false" ] && { [ "$event_type" = "die" ] || ...
  321    if [ "$restart_count" -ge "$max_restarts" ] && { [ "$event_type" = "die" ] ...
  328    return 1  # Don't suppress
         → ตรวจสอบเฉพาะ die/stop/restart — ไม่เคยเช็ค event=start
  }
```

- `event=start` ไม่ได้เข้า case `*"die"*|*"stop"*` หรือ `*"restart"*` → ตกไป default `rank=0, emoji="🟢", status="up"`
- `should_suppress_notification` ไม่มี branch สำหรับ `start`
- ผล: ทุก container start → เพิ่มเข้า batch → `flush_event_batch` ส่ง Discord

impact

```
Stack boot (make core หรือ docker compose up -d):
  N containers → N "🟢 up" messages ใน Discord ภายใน 15s (EVENT_BATCH_WINDOW)
  N ปกติ = 10-15 (database, log, resource, evaluation, scoring, proxy, checker,
        contest, admin×2, ranking, worker, monitor, ...)

ยังไม่ถึง data loss แต่:
  - Discord channel เต็ม → alert อื่น (die/stop/restart) จมหาย
  - operator มองข้าม "🟢 up" → ไม่ distinguish ระหว่าง "boot ปกติ" กับ "recover จาก down"
  - ทุก restart cycle (auto-restart) ก็ flood ด้วย
```

cause note — ทำไม check_once ไม่ช่วย

```
  506  check_once() {
  525    if [ "$IS_ALERT" = true ]; then
  533      if [ "$PREV_STATE" = "ALERT" ]; then
  534        send_discord_alert "RESOLVED" "All systems normal." 65280 ""
         → ส่ง RESOLVED เมื่อ metric (CPU/Mem/Disk) กลับปกติ
         → ไม่เกี่ยวกับ container start/stop — คนละ signal กัน
  }
```

fix (implemented in worktree)

```
scripts/__monitor.sh — insert after line 389 (after should_suppress_notification):

  391    # WHY suppress start events: every container start — the initial stack boot
  392    # and every routine restart — fires a green "up" digest that carries no
  393    # actionable signal. Recovery is already covered by check_once()'s RESOLVED
  394    # alert when a previously-failing metric clears, and die/stop/restart events
  395    # still report every incident. Filtering here keeps the listener running so
  396    # those incident events keep flowing.
  397    if [ "$event_type" = "start" ]; then
  398        return 0
  399    fi
```

- `docker events` filter ยังคงฟัง `event=start` (ไม่ลบออกจาก pipeline) → ถ้าอนาคตต้องการ start event ค่อย uncomment
- die/stop/restart events ยังทำงานปกติ → incident ยังถูก report
- `check_once` RESOLVED alert ยังทำงาน → metric recovery ยังถูก report

---

**[หมายเหตุ]** รายงานนี้แยกจาก config sync bugs (BUG-A..E) — คนละ file, คนละ root cause.
Fix ทั้งหมดอยู่ใน worktree `cms-docker-major-fix` ยังไม่ commit.
