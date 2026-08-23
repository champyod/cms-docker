'use client';

import { Save, Rocket } from 'lucide-react';

interface Props {
  name: string;
  description: string;
  isActive: boolean;
  saving: boolean;
  onSetActive: () => void;
  onSave: () => void;
}

export function ContestDetailHeader({ name, description, isActive, saving, onSetActive, onSave }: Props) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-white">{name}</h1>
          {isActive && <span className="px-3 py-1 rounded-full text-xs font-medium border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 flex items-center gap-1.5"><Rocket className="w-3 h-3" />Active Contest</span>}
        </div>
        <p className="text-neutral-400 mt-1">{description}</p>
      </div>
      <div className="flex items-center gap-3">
        {!isActive && <button onClick={onSetActive} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 rounded-lg transition-colors text-sm disabled:opacity-50"><Rocket className="w-4 h-4" />Set as Active Contest</button>}
        <button onClick={onSave} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors disabled:opacity-50"><Save className="w-4 h-4" />{saving ? 'Saving...' : 'Save Changes'}</button>
      </div>
    </div>
  );
}
