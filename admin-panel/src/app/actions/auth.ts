'use server';

import { prisma } from "@/lib/prisma";
import { createSession, deleteSession, getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";

export async function login(prevState: any, formData: FormData) {
  const username = formData.get("username") as string;
  const password = formData.get("password") as string;

  if (!username || !password) {
    return { error: "Username and password are required" };
  }

  try {
    const admin = await prisma.admins.findUnique({
      where: { username },
    });

    if (!admin || !admin.enabled) {
      return { error: "Invalid credentials or account disabled" };
    }

    let storedHash = admin.authentication;
    if (storedHash.startsWith("bcrypt:")) {
      storedHash = storedHash.substring(7);
    }

    const isValid = await bcrypt.compare(password, storedHash);

    if (!isValid) {
      return { error: "Invalid credentials" };
    }

    await createSession(admin.id.toString(), admin.username, {
      permission_all: admin.permission_all,
      permission_tasks: admin.permission_tasks,
      permission_users: admin.permission_users,
      permission_contests: admin.permission_contests,
    });
    
  } catch (error) {
    console.error("Login error:", error);
    return { error: "An unexpected error occurred" };
  }

  revalidatePath("/");
  redirect("/en");
}

export async function logout() {
  await deleteSession();
  redirect("/en/auth/login");
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session || !session.userId) return null;

  // Convert userId to number safely
  const id = parseInt(session.userId);
  if (isNaN(id)) return null;

  const admin = await prisma.admins.findUnique({
    where: { id }
  });
  return admin;
}
