#!/usr/bin/env bun
import { write, file, spawn } from "bun";
import { join } from "path";
import fs from "fs";

// Configuration from environment
const BACKUP_DIR = process.env.BACKUP_DIR || "./backups";
const DATABASE_URL = process.env.DATABASE_URL;
const MAX_BACKUPS = parseInt(process.env.BACKUP_MAX_COUNT || "50");
const MAX_AGE_DAYS = parseInt(process.env.BACKUP_MAX_AGE_DAYS || "10");
const MAX_SIZE_GB = parseFloat(process.env.BACKUP_MAX_SIZE_GB || "5");
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_ROLE_ID = process.env.DISCORD_ROLE_ID;

async function sendDiscordLog(message: string, color: number = 3447003, mention: boolean = false) {
  if (!DISCORD_WEBHOOK_URL) return;
  
  try {
    const payload: any = {
      embeds: [{
        title: "CMS Backup System",
        description: message,
        color: color,
        timestamp: new Date().toISOString()
      }]
    };

    if (mention && DISCORD_ROLE_ID) {
      payload.content = `<@&${DISCORD_ROLE_ID}>`;
    }

    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    console.error("Failed to send discord log:", e);
  }
}

async function runBackup() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `submissions-backup-${timestamp}.csv`;
  const filePath = join(BACKUP_DIR, filename);

  console.log(`Starting backup to ${filePath}...`);

  try {
    const exportQuery = "COPY (SELECT * FROM submissions) TO STDOUT WITH CSV HEADER";
    const cmd = ["psql", DATABASE_URL || "", "-c", exportQuery];
    
    const proc = spawn(cmd, {
        stdout: "pipe",
        stderr: "pipe"
    });

    const output = await new Response(proc.stdout).text();
    const error = await new Response(proc.stderr).text();

    if (error && !output) {
        throw new Error(error);
    }

    await write(filePath, output);
    
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    await sendDiscordLog(`✅ **Backup Successful**\nFilename: 
${filename}
Size: ${sizeMB} MB`, 65280, false);
    console.log(`Backup completed: ${filename} (${sizeMB} MB)`);
    
    await runCleanup();
  } catch (e: any) {
    console.error("Backup failed:", e);
    await sendDiscordLog(`❌ **Backup Failed**\nError: ${e.message}`, 16711680, true);
  }
}

async function runCleanup() {
  console.log("Starting cleanup...");
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".csv"))
    .map(f => ({
      name: f,
      path: join(BACKUP_DIR, f),
      stats: fs.statSync(join(BACKUP_DIR, f))
    }))
    .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);

  if (files.length <= 1) {
    console.log("Nothing to clean.");
    return;
  }

  let deletedCount = 0;
  let deletedSize = 0;

  if (MAX_BACKUPS > 0 && files.length > MAX_BACKUPS) {
    const toDelete = files.slice(MAX_BACKUPS);
    for (const f of toDelete) {
      fs.unlinkSync(f.path);
      deletedCount++;
      deletedSize += f.stats.size;
    }
  }

  const remainingFiles = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".csv"))
    .map(f => ({
      name: f,
      path: join(BACKUP_DIR, f),
      stats: fs.statSync(join(BACKUP_DIR, f))
    }))
    .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);

  const now = Date.now();
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (MAX_AGE_DAYS > 0) {
    for (let i = 1; i < remainingFiles.length; i++) {
      const f = remainingFiles[i];
      if (now - f.stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(f.path);
        deletedCount++;
        deletedSize += f.stats.size;
      }
    }
  }

  let currentTotalSize = remainingFiles.reduce((acc, f) => acc + f.stats.size, 0);
  const maxTotalSize = MAX_SIZE_GB * 1024 * 1024 * 1024;
  if (MAX_SIZE_GB > 0 && currentTotalSize > maxTotalSize) {
    const currentFiles = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith(".csv"))
        .map(f => ({
          name: f,
          path: join(BACKUP_DIR, f),
          stats: fs.statSync(join(BACKUP_DIR, f))
        }))
        .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);

    for (let i = 1; i < currentFiles.length; i++) {
      if (currentTotalSize <= maxTotalSize) break;
      const f = currentFiles[i];
      fs.unlinkSync(f.path);
      deletedCount++;
      deletedSize += f.stats.size;
      currentTotalSize -= f.stats.size;
    }
  }

  if (deletedCount > 0) {
    const sizeMB = (deletedSize / (1024 * 1024)).toFixed(2);
    await sendDiscordLog(`🧹 **Cleanup Performed**\nDeleted ${deletedCount} old backups.\nSpace freed: ${sizeMB} MB`, 15844367, false);
  }
}

if (import.meta.main) {
    if (process.argv.includes("--cleanup-only")) {
        runCleanup();
    } else {
        runBackup();
    }
}