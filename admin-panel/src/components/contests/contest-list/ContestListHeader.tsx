'use client';

import Link from 'next/link';
import { Plus, HelpCircle } from 'lucide-react';
import { Button } from '@/components/core/Button';

interface Props { locale: string; canManage: boolean; onCreate: () => void; }

export function ContestListHeader({ locale, canManage, onCreate }: Props) {
  return (
    <div className="flex justify-between items-center">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold text-white">All Contests</h2>
        <Link href={`/${locale}/docs#contests`} className="p-1 hover:bg-white/10 rounded-full transition-colors text-neutral-400 hover:text-white" title="View Documentation"><HelpCircle className="w-4 h-4" /></Link>
      </div>
      {canManage && <Button variant="primary" className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white pl-3 pr-4" onClick={onCreate}><Plus className="w-4 h-4" />Create Contest</Button>}
    </div>
  );
}
