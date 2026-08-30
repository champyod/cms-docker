import { logout } from '@/app/actions/auth';

export default async function SignOutPage() {
  await logout();

  // logout() calls redirect() which throws — this render never completes
  return null;
}
