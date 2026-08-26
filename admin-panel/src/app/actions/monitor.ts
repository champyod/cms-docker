'use server';

import { prisma } from '@/lib/prisma';
import { ensurePermission } from '@/lib/permissions';
import { revalidatePath } from 'next/cache';

interface AddMonitorTargetInput {
  url: string;
  interval?: number;
  timeout?: number;
  expectedStatus?: number;
  alertDiscord?: boolean;
}

export async function getMonitorTargets() {
  await ensurePermission('all');
  try {
    const targets = await prisma.monitor_targets.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: targets };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function addMonitorTarget(input: AddMonitorTargetInput) {
  await ensurePermission('all');
  try {
    const target = await prisma.monitor_targets.create({
      data: {
        url: input.url,
        interval: input.interval ?? 60,
        timeout: input.timeout ?? 5,
        expectedStatus: input.expectedStatus ?? 200,
        alertDiscord: input.alertDiscord ?? true,
      },
    });
    revalidatePath('/settings', 'page');
    return { success: true, data: target };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function updateMonitorTarget(
  id: string,
  data: Partial<AddMonitorTargetInput>,
) {
  await ensurePermission('all');
  try {
    const target = await prisma.monitor_targets.update({
      where: { id },
      data,
    });
    revalidatePath('/settings', 'page');
    return { success: true, data: target };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function removeMonitorTarget(id: string) {
  await ensurePermission('all');
  try {
    await prisma.monitor_targets.delete({ where: { id } });
    revalidatePath('/settings', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function toggleMonitorTarget(id: string) {
  await ensurePermission('all');
  try {
    const existing = await prisma.monitor_targets.findUnique({ where: { id } });
    if (!existing) {
      return { success: false, error: 'Target not found' };
    }
    const target = await prisma.monitor_targets.update({
      where: { id },
      data: { enabled: !existing.enabled },
    });
    revalidatePath('/settings', 'page');
    return { success: true, data: target };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function testMonitorTarget(id: string) {
  await ensurePermission('all');
  try {
    const target = await prisma.monitor_targets.findUnique({ where: { id } });
    if (!target) {
      return { success: false, error: 'Target not found' };
    }

    const controller = new AbortController();
    const timeoutMs = target.timeout * 1000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const start = Date.now();
    const response = await fetch(target.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'CMS-Monitor/1.0' },
    });
    const latency = Date.now() - start;
    clearTimeout(timeoutId);

    return {
      success: true,
      data: {
        status: response.status,
        expectedStatus: target.expectedStatus,
        matched: response.status === target.expectedStatus,
        latency,
      },
    };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}
