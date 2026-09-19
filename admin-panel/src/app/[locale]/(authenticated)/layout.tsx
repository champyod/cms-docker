import { Sidebar, SIDEBAR_STORAGE_KEY } from "@/components/layout/Sidebar";
import { MobileNav } from "@/components/layout/MobileNav";
import { Header } from "@/components/layout/Header";
import { getSession, refreshSession } from "@/lib/auth";
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

  // Why: refresh validates session liveness and clears cookie if disabled; failure means timeout so redirect once
  const refreshedSessionToken = await refreshSession(session);
  if (!refreshedSessionToken) {
    redirect(`/${locale}/auth/login`);
  }

  const sidebarExpanded = (await cookies()).get(SIDEBAR_STORAGE_KEY)?.value !== '0';

  // Why: loaded here rather than in each page so the dialog and toast copy every client component
  // renders shares one source, and the Thai locale reaches strings the user must act on.
  const dict = await getDictionary(locale);

  // Why: Sidebar must reflect current database permissions not stale token claims
  const freshPermissions = await getFreshPermissions(session.userId);
  const permissionKeys: readonly string[] = freshPermissions ? Array.from(freshPermissions) : [];

  return (
    <DictionaryProvider dict={dict}>
      <ConfirmProvider>
        <PageBackground className="flex h-screen overflow-hidden">
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
