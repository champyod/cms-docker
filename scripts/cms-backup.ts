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

async function sendDiscordLog(message: string, color: number = 3447003) {
  if (!DISCORD_WEBHOOK_URL) return;
  
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: "CMS Backup System",
          description: message,
          color: color,
          timestamp: new Date().toISOString()
        }]
      })
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
    // We use psql to export to CSV
    // Assuming DATABASE_URL is available and psql is installed in the container
    // Alternatively, we could use prisma or pg client, but psql is very efficient for CSV export.
    
    // Construct psql command for CSV export
    // We need to handle the case where we are running inside a container and connecting to 'database' host
    const exportQuery = "COPY (SELECT * FROM submissions) TO STDOUT WITH CSV HEADER";
    
    // We'll use the environment variables directly if possible or parse DATABASE_URL
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
Size: ${sizeMB} MB`, 65280);
    console.log(`Backup completed: ${filename} (${sizeMB} MB)`);
    
    await runCleanup();
  } catch (e: any) {
    console.error("Backup failed:", e);
    await sendDiscordLog(`❌ **Backup Failed**\nError: ${e.message}`, 16711680);
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
    .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs); // Newest first

  if (files.length <= 1) {
    console.log("Nothing to clean (at least 1 backup kept).");
    return;
  }

  let deletedCount = 0;
  let deletedSize = 0;

  // 1. Clean by count
  if (MAX_BACKUPS > 0 && files.length > MAX_BACKUPS) {
    const toDelete = files.slice(MAX_BACKUPS);
    for (const f of toDelete) {
      fs.unlinkSync(f.path);
      deletedCount++;
      deletedSize += f.stats.size;
    }
  }

  // Refresh list after count cleanup
  const remainingFiles = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith(".csv"))
    .map(f => ({
      name: f,
      path: join(BACKUP_DIR, f),
      stats: fs.statSync(join(BACKUP_DIR, f))
    }))
    .sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);

  // 2. Clean by age
  const now = Date.now();
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (MAX_AGE_DAYS > 0) {
    // Keep at least one!
    for (let i = 1; i < remainingFiles.length; i++) {
      const f = remainingFiles[i];
      if (now - f.stats.mtimeMs > maxAgeMs) {
        fs.unlinkSync(f.path);
        deletedCount++;
        deletedSize += f.stats.size;
      }
    }
  }

  // 3. Clean by size
  let currentTotalSize = remainingFiles.reduce((acc, f) => acc + f.stats.size, 0);
  const maxTotalSize = MAX_SIZE_GB * 1024 * 1024 * 1024;
  if (MAX_SIZE_GB > 0 && currentTotalSize > maxTotalSize) {
    // Re-refresh remaining
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
    await sendDiscordLog(`🧹 **Cleanup Performed**\nDeleted ${deletedCount} old backups.\nSpace freed: ${sizeMB} MB`, 15844367);
    console.log(`Cleanup finished: deleted ${deletedCount} files.`);
  } else {
    console.log("No cleanup needed.");
  }
}

// Check if running directly
if (import.meta.main) {
    if (process.argv.includes("--cleanup-only")) {
        runCleanup();
    } else {
        runBackup();
    }
}
