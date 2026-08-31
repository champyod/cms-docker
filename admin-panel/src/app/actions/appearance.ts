'use server';

import fs from 'fs/promises';
import path from 'path';

import { ensurePermission } from '@/lib/permissions';
import { getRepoRoot } from '@/lib/repo-root';

function sanitizeValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function isValidKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

export async function readConfigToml(): Promise<{ success: true; content: string; values: Record<string, string> } | { success: false; error: string }> {
  await ensurePermission('all');
  try {
    const repoRoot = getRepoRoot();
    const tomlPath = path.join(repoRoot, 'config.toml');
    let content: string;
    try {
      content = await fs.readFile(tomlPath, 'utf-8');
    } catch {
      const fallback = path.join(repoRoot, 'config.toml.example');
      content = await fs.readFile(fallback, 'utf-8');
    }
    const values: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (isValidKey(key)) values[key] = val;
    }
    return { success: true, content, values };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function updateConfigToml(updates: Record<string, string>): Promise<{ success: true } | { success: false; error: string }> {
  await ensurePermission('all');
  try {
    const repoRoot = getRepoRoot();
    const tomlPath = path.join(repoRoot, 'config.toml');
    let content: string;
    try {
      content = await fs.readFile(tomlPath, 'utf-8');
    } catch {
      const fallback = path.join(repoRoot, 'config.toml.example');
      content = await fs.readFile(fallback, 'utf-8');
    }
    for (const [key, rawValue] of Object.entries(updates)) {
      if (!isValidKey(key)) continue;
      const value = sanitizeValue(rawValue);
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^\\s*${escaped}\\s*=.*$`, 'm');
      const newLine = `${key} = ${value}`;
      if (regex.test(content)) {
        content = content.replace(regex, newLine);
      } else {
        content = `${content.trimEnd()}\n${newLine}\n`;
      }
    }
    await fs.writeFile(tomlPath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
