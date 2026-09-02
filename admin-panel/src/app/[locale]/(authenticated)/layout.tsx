import { Sidebar, SIDEBAR_STORAGE_KEY } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { getSession, refreshSession } from "@/lib/auth";
import { getFreshPermissions } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { PageBackground } from "@/components/core/PageBackground";
import { Stack } from "@/components/core/Layout";
import { ShortcutLayer } from "@/components/layout/ShortcutOverlay";

export default async function AuthenticatedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const resolvedParams = await params;
  const { locale } = resolvedParams;

  const session = await getSession();

  if (!session) {
    redirect(`/${locale}/auth/login`);
  }

  // Why: refresh validates session liveness and clears cookie if disabled; failure means timeout so redirect once
  const refreshedSessionToken = await refreshSession(session);
  if (!refreshedSessionToken) {
    redirect(`/${locale}/auth/login`);
  }

  const sidebarExpanded = (await cookies()).get(SIDEBAR_STORAGE_KEY)?.value !== '0';

  // Why: Sidebar must reflect current database permissions not stale token claims
  const freshPermissions = await getFreshPermissions(session.userId);
  const sidebarPermissions = freshPermissions
    ? {
        permission_all: freshPermissions.all,
        permission_tasks: freshPermissions.tasks,
        permission_users: freshPermissions.users,
        permission_contests: freshPermissions.contests,
        permission_messaging: freshPermissions.messaging,
      }
    : {
        permission_all: session.permissions.permission_all,
        permission_tasks: session.permissions.permission_tasks,
        permission_users: session.permissions.permission_users,
        permission_contests: session.permissions.permission_contests,
        permission_messaging: session.permissions.permission_messaging,
      };

  return (
    <PageBackground className="flex h-screen overflow-hidden">
      <Sidebar
        className="z-20"
        locale={locale}
        permissions={sidebarPermissions}
        initialExpanded={sidebarExpanded}
      />
      <Stack as="main" className="flex-1 min-h-0 relative overflow-hidden" gap={0}>
        <Header className="z-10" username={session.username} />

        <div className="flex-1 overflow-y-auto p-8 z-10 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
          {children}
        </div>
      </Stack>
      <ShortcutLayer />
    </PageBackground>
  );
}
