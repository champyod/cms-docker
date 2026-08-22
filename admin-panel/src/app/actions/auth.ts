'use server';

import { prisma } from "@/lib/prisma";
import { createSession, deleteSession, getSession } from "@/lib/auth";
import { redirect } from "@/lib/redirect";
import { safeAdminSelect } from "@/lib/prisma-selects";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const DUMMY_BCRYPT_HASH = '$2a$10$C6UzMDM.H6dfI/f/IKcEeO7ZBpQz0l8Dp5uJHnKzTKmPqR3sWbGyq';

const loginBuckets = new Map<string, { count: number; resetAt: number }>();

function evictOldestLoginBucket(): void {
  let oldestKey: string | null = null;
  let oldestResetAt = Infinity;
  for (const [key, entry] of loginBuckets) {
    if (entry.resetAt < oldestResetAt) {
      oldestResetAt = entry.resetAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== null) {
    loginBuckets.delete(oldestKey);
  }
}

export async function login(prevState: any, formData: FormData) {
  const username = formData.get("username") as string;
  const password = formData.get("password") as string;

  if (!username || !password) {
    return { error: "Username and password are required" };
  }

  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const bucketKey = `${username}|${ip}`;

  for (const [key, entry] of loginBuckets) {
    if (Date.now() >= entry.resetAt) {
      loginBuckets.delete(key);
    }
  }

  const bucket = loginBuckets.get(bucketKey);
  if (bucket && bucket.count >= 5 && Date.now() < bucket.resetAt) {
    return { success: false, error: 'Too many attempts. Try again later.' };
  }

  try {
    const admin = await prisma.admins.findUnique({
      where: { username },
    });

    if (!admin || !admin.enabled) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      return { error: "Invalid credentials" };
    }

    const stored = admin.authentication;
    let isValid = false;

    if (stored.startsWith("plaintext:")) {
      const expected = stored.substring(10);
      const a = Buffer.from(password);
      const b = Buffer.from(expected);
      isValid = a.length === b.length && crypto.timingSafeEqual(a, b);
    } else {
      let hash = stored;
      if (hash.startsWith("bcrypt:")) {
        hash = hash.substring(7);
      }
      isValid = await bcrypt.compare(password, hash);
    }

    if (!isValid) {
      const failed = loginBuckets.get(bucketKey) ?? { count: 0, resetAt: 0 };
      failed.count += 1;
      failed.resetAt = Date.now() + 15 * 60 * 1000;
      loginBuckets.set(bucketKey, failed);
      if (loginBuckets.size >= 1000) {
        evictOldestLoginBucket();
      }
      return { error: "Invalid credentials" };
    }

    await createSession(admin.id.toString(), admin.username, {
      permission_all: admin.permission_all,
      permission_tasks: admin.permission_tasks,
      permission_users: admin.permission_users,
      permission_contests: admin.permission_contests,
      permission_messaging: admin.permission_messaging,
    });

    try {
      await prisma.admins.update({ where: { id: admin.id }, data: { last_login_at: new Date() } });
    } catch {
    }

    loginBuckets.delete(bucketKey);
    if (loginBuckets.size >= 1000) {
      evictOldestLoginBucket();
    }

  } catch (error) {
    console.error("Login error:", error);
    return { error: "An unexpected error occurred" };
  }

  revalidatePath("/");
  await redirect("/");
}

export async function logout() {
  await deleteSession();
  await redirect("/auth/login");
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session || !session.userId) return null;

  // Convert userId to number safely
  const id = parseInt(session.userId);
  if (isNaN(id)) return null;

  const admin = await prisma.admins.findUnique({
    where: { id },
    select: { ...safeAdminSelect },
  });
  return admin;
}
