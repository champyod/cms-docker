import { redirect } from 'next/navigation';

/**
 * Why this route still exists: permission groups and admin accounts share the tabbed /permissions page,
 * and the old addresses stay reachable so existing bookmarks, chord history and links keep working.
 */
export default async function GroupsRedirectPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<never> {
  const { locale } = await params;
  return redirect(`/${locale}/permissions?tab=groups`);
}
