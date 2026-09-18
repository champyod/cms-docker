import { redirect } from 'next/navigation';

/**
 * Why this route still exists: admin accounts and permission groups share the tabbed /permissions page,
 * and the old addresses stay reachable so existing bookmarks, chord history and links keep working.
 */
export default async function AdminsRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<never> {
  const { locale } = await params;
  return redirect(`/${locale}/permissions?tab=admins`);
}
