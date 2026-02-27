'use client';

import React, { useActionState } from 'react';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import { Button } from '@/components/core/Button';
import { Lock, User, AlertCircle } from 'lucide-react';
import { login } from '@/app/actions/auth';
import { AuthBackground } from '@/components/core/PageBackground';
import { Stack } from '@/components/core/Layout';
import { Text } from '@/components/core/Typography';

export default function LoginPage() {
  const [state, loginAction, pending] = useActionState(login, null);

  return (
    <AuthBackground>
      <Card className="w-full max-w-md p-8 backdrop-blur-2xl bg-black/40 border-white/10">
        <Stack align="center" gap={8} className="mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
             <Lock className="w-6 h-6 text-white" />
          </div>
          <Stack align="center" gap={2}>
            <Text variant="h2">Welcome Back</Text>
            <Text variant="muted">Sign in to access the admin panel</Text>
          </Stack>
        </Stack>

        <form action={loginAction}>
          <Stack gap={6}>
            {state?.error && (
              <Stack direction="row" align="center" gap={3} className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <p>{state.error}</p>
              </Stack>
            )}

            <Input 
              name="username"
              label="Username" 
              placeholder="admin" 
              icon={<User className="w-4 h-4" />}
              required
            />
            <Input 
              name="password"
              label="Password" 
              type="password" 
              placeholder="••••••••" 
              icon={<Lock className="w-4 h-4" />}
              required
            />
            
            <Button type="submit" className="w-full" size="lg" disabled={pending}>
              {pending ? "Signing In..." : "Sign In"}
            </Button>
          </Stack>
        </form>
      </Card>
    </AuthBackground>
  );
}
