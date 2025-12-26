'use server';

import { prisma } from "@/lib/prisma";
import { createSession, deleteSession } from "@/lib/auth";
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

    // CMS uses bcrypt for passwords
    // Note: The 'authentication' field in CMS 'admins' table starts with 'bcrypt:' prefix usually
    // or it might be raw bcrypt. Let's handle both.
    let storedHash = admin.authentication;
    if (storedHash.startsWith("bcrypt:")) {
      storedHash = storedHash.substring(7);
    }

    const isValid = await bcrypt.compare(password, storedHash);

    if (!isValid) {
      return { error: "Invalid credentials" };
    }

    await createSession(admin.id.toString());
    
  } catch (error) {
    console.error("Login error:", error);
    return { error: "An unexpected error occurred" };
  }

  revalidatePath("/");
  redirect("/en"); // Adjust based on locale if needed
}

export async function logout() {
  await deleteSession();
  redirect("/en/auth/login");
}
