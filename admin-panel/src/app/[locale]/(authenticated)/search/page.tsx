'use client';

import { useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Card } from '@/components/core/Card';
import { searchAll } from '@/app/actions/search'; // We'll implement this
import { Users, Trophy, ClipboardList, Shield } from 'lucide-react';
import Link from 'next/link';

export default function SearchPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const locale = pathname.split('/')[1] || 'en';
  const query = searchParams.get('q') || '';
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query) {
      setLoading(true);
      searchAll(query).then(data => {
        setResults(data);
        setLoading(false);
      });
    }
  }, [query]);

  if (!query) return <div className="text-white">Please enter a search term.</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Search Results for "{query}"</h1>
      
      {loading && <div className="text-neutral-400">Searching...</div>}
      
      {!loading && results && (
        <div className="space-y-8">
            {/* Users */}
            {results.users.length > 0 && (
                <section>
                    <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                        <Users className="text-blue-400" /> Users ({results.users.length})
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {results.users.map((u: any) => (
                            <Link href={`/${locale}/users/${u.id}`} key={u.id}>
                                <Card className="p-4 hover:bg-white/5 transition-colors cursor-pointer">
                                    <div className="font-bold text-white">{u.username}</div>
                                    <div className="text-sm text-neutral-400">{u.first_name} {u.last_name}</div>
                                </Card>
                            </Link>
                        ))}
                    </div>
                </section>
            )}

            {/* Tasks */}
            {results.tasks.length > 0 && (
                <section>
                    <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                        <ClipboardList className="text-emerald-400" /> Tasks ({results.tasks.length})
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {results.tasks.map((t: any) => (
                            <Link href={`/${locale}/tasks/${t.id}`} key={t.id}>
                                <Card className="p-4 hover:bg-white/5 transition-colors cursor-pointer">
                                    <div className="font-bold text-white">{t.name}</div>
                                    <div className="text-sm text-neutral-400">{t.title}</div>
                                </Card>
                            </Link>
                        ))}
                    </div>
                </section>
            )}

            {/* Contests */}
            {results.contests.length > 0 && (
                <section>
                    <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                        <Trophy className="text-amber-400" /> Contests ({results.contests.length})
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {results.contests.map((c: any) => (
                            <Link href={`/${locale}/contests/${c.id}`} key={c.id}>
                                <Card className="p-4 hover:bg-white/5 transition-colors cursor-pointer">
                                    <div className="font-bold text-white">{c.name}</div>
                                    <div className="text-sm text-neutral-400">{c.description}</div>
                                </Card>
                            </Link>
                        ))}
                    </div>
                </section>
            )}
            
             {/* Admins */}
            {results.admins.length > 0 && (
                <section>
                    <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                        <Shield className="text-purple-400" /> Admins ({results.admins.length})
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {results.admins.map((a: any) => (
                            <div key={a.id} className="cursor-default">
                                <Card className="p-4 bg-white/5">
                                    <div className="font-bold text-white">{a.username}</div>
                                    <div className="text-sm text-neutral-400">{a.name}</div>
                                </Card>
                            </div>
                        ))}
                    </div>
                </section>
            )}
            
            {results.users.length === 0 && results.tasks.length === 0 && results.contests.length === 0 && results.admins.length === 0 && (
                <div className="text-neutral-500">No results found.</div>
            )}
        </div>
      )}
    </div>
  );
}
