import { logout } from '@/app/actions/auth';

export default async function SignOutPage() {
  // Call the logout action to delete the session
  await logout();
  
  // Note: logout() calls redirect() which throws, so this won't render
  return null;
}
