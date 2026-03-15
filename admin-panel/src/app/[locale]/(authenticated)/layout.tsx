import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { getSession, refreshSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PageBackground } from "@/components/core/PageBackground";
import { Stack } from "@/components/core/Layout";

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
    console.log(`[AuthGuard] No session found, redirecting to login`);
    redirect(`/${locale}/auth/login`);
  }

  await refreshSession(session);

  return (
    <PageBackground className="flex h-screen overflow-hidden">
      <Sidebar className="z-20" locale={locale} permissions={session.permissions} />
      <Stack as="main" className="flex-1 min-h-0 relative overflow-hidden" gap={0}>
        <Header className="z-10" username={session.username} />

        <div className="flex-1 overflow-y-auto p-8 z-10 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20">
          {children}
        </div>
      </Stack>
    </PageBackground>
  );
}
