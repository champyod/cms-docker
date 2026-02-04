'use client';

import { useSearchParams, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { searchAll } from '@/app/actions/search';
import { Users, Trophy, ClipboardList, Shield } from 'lucide-react';
import Link from 'next/link';
import { SearchResultCard, SectionHeader } from '@/components/search/SearchComponents';

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
                    <SectionHeader title="Users" count={results.users.length} icon={Users} iconColor="text-blue-400" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {results.users.map((u: any) => (
                            <Link href={`/${locale}/users/${u.id}`} key={u.id}>
                                <SearchResultCard title={u.username} subtitle={`${u.first_name} ${u.last_name}`} />
                            </Link>
                        ))}
                    </div>
                </section>
            )}

            {/* Tasks */}
            {results.tasks.length > 0 && (
                <section>
                    <SectionHeader title="Tasks" count={results.tasks.length} icon={ClipboardList} iconColor="text-emerald-400" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {results.tasks.map((t: any) => (
                            <Link href={`/${locale}/tasks/${t.id}`} key={t.id}>
                                <SearchResultCard title={t.name} subtitle={t.title} />
                            </Link>
                        ))}
                    </div>
                </section>
            )}

            {/* Contests */}
            {results.contests.length > 0 && (
                <section>
                     <SectionHeader title="Contests" count={results.contests.length} icon={Trophy} iconColor="text-amber-400" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {results.contests.map((c: any) => (
                            <Link href={`/${locale}/contests/${c.id}`} key={c.id}>
                                <SearchResultCard title={c.name} subtitle={c.description} />
                            </Link>
                        ))}
                    </div>
                </section>
            )}
            
             {/* Admins */}
            {results.admins.length > 0 && (
                <section>
                    <SectionHeader title="Admins" count={results.admins.length} icon={Shield} iconColor="text-purple-400" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {results.admins.map((a: any) => (
                            <div key={a.id} className="cursor-default">
                                <SearchResultCard title={a.username} subtitle={a.name} className="cursor-default hover:bg-white/5" />
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
