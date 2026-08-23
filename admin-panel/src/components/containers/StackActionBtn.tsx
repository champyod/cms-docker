interface StackActionBtnProps {
  label: string;
  onRestart: () => void;
  onUp: () => void;
  onBuild: () => void;
}

export function StackActionBtn({ label, onRestart, onUp, onBuild }: StackActionBtnProps) {
    return (
        <div className="bg-black/20 p-3 rounded-xl border border-white/5 space-y-2">
            <div className="text-xs font-bold text-neutral-400">{label}</div>
            <div className="flex gap-1">
                <button onClick={onRestart} className="flex-1 p-1 bg-white/5 hover:bg-white/10 rounded text-[10px] text-white transition-colors">Restart</button>
                <button onClick={onUp} className="flex-1 p-1 bg-white/5 hover:bg-white/10 rounded text-[10px] text-white transition-colors">Up</button>
                <button onClick={onBuild} className="flex-1 p-1 bg-indigo-600/20 hover:bg-indigo-600/40 rounded text-[10px] text-indigo-400 transition-colors">Build</button>
            </div>
        </div>
    );
}
