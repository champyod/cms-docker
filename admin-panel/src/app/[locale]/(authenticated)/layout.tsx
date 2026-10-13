import { Sidebar, SIDEBAR_STORAGE_KEY } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { Header } from "@/components/layout/Header";
import { getSession, readSessionStatus } from "@/lib/auth";
import { getFreshPermissions } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { PageBackground } from "@/components/core/PageBackground";
import { Stack } from "@/components/core/Layout";
import { ShortcutLayer } from "@/components/layout/ShortcutOverlay";
import { MAIN_SCROLL_CONTAINER_ID, ScrollReset } from "@/components/layout/ScrollReset";
import { DeployContestProvider } from "@/components/providers/DeployContestProvider";
import { DictionaryProvider } from "@/components/providers/DictionaryProvider";
import { ConfirmProvider } from "@/components/providers/ConfirmProvider";
import { getDictionary } from "@/i18n";

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

  // Why: once the session is known these four are independent — status, the sidebar
  // cookie, the dictionary and the fresh permissions — so they resolve in one
  // round-trip instead of a serial chain per request.
  const [sessionStatus, cookieStore, dict, freshPermissions] = await Promise.all([
    readSessionStatus(session.userId),
    cookies(),
    getDictionary(locale),
    getFreshPermissions(session.userId),
  ]);

  // Why: liveness is read-only here because rendering cannot write cookies; the session
  // slide and the disabled-admin clear happen on the proxy response. Anything but active
  // means timeout or revoked, so redirect once.
  if (sessionStatus.state !== "active") {
    redirect(`/${locale}/auth/login`);
  }

  const sidebarExpanded = cookieStore.get(SIDEBAR_STORAGE_KEY)?.value !== '0';

  // Why: Sidebar must reflect current database permissions not stale token claims
  const permissionKeys: readonly string[] = freshPermissions ? Array.from(freshPermissions) : [];

  return (
    <DictionaryProvider dict={dict}>
      <ConfirmProvider>
        <PageBackground className="flex h-screen overflow-hidden" data-authenticated-shell="true">
          <Sidebar
            className="z-20 hidden md:flex"
            locale={locale}
            permissionKeys={permissionKeys}
            initialExpanded={sidebarExpanded}
          />
          <Stack as="main" className="flex-1 min-h-0 relative overflow-hidden" gap={0}>
            <Header className="z-10" username={session.username} permissionKeys={permissionKeys} />

            <div id={MAIN_SCROLL_CONTAINER_ID} className="flex-1 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8 lg:pb-8 z-10 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
              <DeployContestProvider>{children}</DeployContestProvider>
            </div>
            <ScrollReset containerId={MAIN_SCROLL_CONTAINER_ID} />
          </Stack>
          <MobileNav locale={locale} permissionKeys={permissionKeys} />
          <ShortcutLayer permissionKeys={permissionKeys} />
        </PageBackground>
      </ConfirmProvider>
    </DictionaryProvider>
  );
}
