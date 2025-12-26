'use client';

import React, { useActionState } from 'react';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import { Button } from '@/components/core/Button';
import { Lock, User, AlertCircle } from 'lucide-react';
import { login } from '@/app/actions/auth';

export default function LoginPage() {
  const [state, loginAction, pending] = useActionState(login, null);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
       {/* Background */}
       <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-slate-950 to-slate-950 -z-10" />
       
      <Card className="w-full max-w-md p-8 backdrop-blur-2xl bg-black/40 border-white/10">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 mx-auto flex items-center justify-center shadow-lg shadow-indigo-500/20 mb-4">
             <Lock className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Welcome Back</h1>
          <p className="text-slate-400 mt-2">Sign in to access the admin panel</p>
        </div>

        <form action={loginAction} className="space-y-6">
          {state?.error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-red-400 text-sm animate-in fade-in slide-in-from-top-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <p>{state.error}</p>
            </div>
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
        </form>
      </Card>
    </div>
  );
}
