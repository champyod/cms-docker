'use server';

import { prisma } from '@/lib/prisma';
import { ensurePermission, getPermissions } from '@/lib/permissions';
import { stripDisallowedFields } from '@/lib/field-permissions';
import { revalidatePath } from 'next/cache';
import { recordAudit } from '@/lib/audit';

interface AddMonitorTargetInput {
  url: string;
  interval?: number;
  timeout?: number;
  expectedStatus?: number;
  alertDiscord?: boolean;
}

export async function getMonitorTargets() {
  await ensurePermission('monitor:read');
  await ensurePermission('monitor:list');
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
  await ensurePermission('monitor:create');
  const permissions = await getPermissions();
  const allowed = stripDisallowedFields('monitor_targets', {
    url: input.url,
    interval: input.interval ?? 60,
    timeout: input.timeout ?? 5,
    expectedStatus: input.expectedStatus ?? 200,
    alertDiscord: input.alertDiscord ?? true,
  }, permissions);
  if (allowed.url === undefined) {
    return { success: false, error: 'Insufficient field permissions' };
  }
  try {
    const target = await prisma.monitor_targets.create({
      data: {
        url: allowed.url,
        interval: allowed.interval ?? 60,
        timeout: allowed.timeout ?? 5,
        expectedStatus: allowed.expectedStatus ?? 200,
        alertDiscord: allowed.alertDiscord ?? true,
      },
    });
    await recordAudit({
      verb: 'monitor:create',
      entity: 'monitor_target',
      entityId: String(target.id),
      afterValues: allowed,
      result: 'success',
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
  await ensurePermission('monitor:update');
  const permissions = await getPermissions();
  const allowed = stripDisallowedFields('monitor_targets', {
    ...(data.url !== undefined && { url: data.url }),
    ...(data.interval !== undefined && { interval: data.interval }),
    ...(data.timeout !== undefined && { timeout: data.timeout }),
    ...(data.expectedStatus !== undefined && { expectedStatus: data.expectedStatus }),
    ...(data.alertDiscord !== undefined && { alertDiscord: data.alertDiscord }),
  }, permissions);
  if (Object.keys(allowed).length === 0) {
    return { success: false, error: 'No permitted fields to update' };
  }
  try {
    const target = await prisma.monitor_targets.update({
      where: { id },
      data: allowed,
    });
    await recordAudit({
      verb: 'monitor:update',
      entity: 'monitor_target',
      entityId: String(id),
      afterValues: allowed,
      result: 'success',
    });
    revalidatePath('/settings', 'page');
    return { success: true, data: target };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function removeMonitorTarget(id: string) {
  await ensurePermission('monitor:delete');
  let beforeValues: unknown = undefined;
  try {
    beforeValues = await prisma.monitor_targets.findUnique({ where: { id } });
  } catch {
    beforeValues = undefined;
  }
  try {
    await prisma.monitor_targets.delete({ where: { id } });
    await recordAudit({
      verb: 'monitor:delete',
      entity: 'monitor_target',
      entityId: String(id),
      beforeValues,
      result: 'success',
    });
    revalidatePath('/settings', 'page');
    return { success: true };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function toggleMonitorTarget(id: string) {
  await ensurePermission('monitor:update');
  try {
    const existing = await prisma.monitor_targets.findUnique({ where: { id } });
    if (!existing) {
      return { success: false, error: 'Target not found' };
    }
    const permissions = await getPermissions();
    const allowed = stripDisallowedFields('monitor_targets', { enabled: !existing.enabled }, permissions);
    if (allowed.enabled === undefined) {
      return { success: false, error: 'Insufficient permissions to toggle enabled' };
    }
    const target = await prisma.monitor_targets.update({
      where: { id },
      data: { enabled: allowed.enabled },
    });
    await recordAudit({
      verb: 'monitor:update',
      entity: 'monitor_target',
      entityId: String(id),
      beforeValues: { enabled: existing.enabled },
      afterValues: { enabled: allowed.enabled },
      result: 'success',
    });
    revalidatePath('/settings', 'page');
    return { success: true, data: target };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function testMonitorTarget(id: string) {
  await ensurePermission('monitor:test');
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
