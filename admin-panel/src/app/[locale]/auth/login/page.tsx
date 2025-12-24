'use client';

import React from 'react';
import { Card } from '@/components/core/Card';
import { Input } from '@/components/core/Input';
import { Button } from '@/components/core/Button';
import { Lock, User } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate login
    router.push('/en');
  };

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

        <form onSubmit={handleLogin} className="space-y-6">
          <Input 
            label="Username" 
            placeholder="admin" 
            icon={<User className="w-4 h-4" />}
          />
          <Input 
            label="Password" 
            type="password" 
            placeholder="••••••••" 
            icon={<Lock className="w-4 h-4" />}
          />
          
          <Button type="submit" className="w-full" size="lg">
            Sign In
          </Button>
        </form>
      </Card>
    </div>
  );
}
