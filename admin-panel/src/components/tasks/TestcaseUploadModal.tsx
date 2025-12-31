'use client';

import { useState, useRef } from 'react';
import { X, Upload, FileText, Check, AlertCircle, Loader } from 'lucide-react';
import { Portal } from '../core/Portal';
import { batchUploadTestcases } from '@/app/actions/testcases';

interface TestcaseUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  datasetId: number;
  onSuccess: () => void;
}

interface FilePair {
  codename: string;
  input: File | null;
  output: File | null;
  status: 'ready' | 'missing_output' | 'missing_input' | 'uploaded' | 'error';
  errorMessage?: string;
}

export function TestcaseUploadModal({ isOpen, onClose, datasetId, onSuccess }: TestcaseUploadModalProps) {
  const [pairs, setPairs] = useState<FilePair[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFiles = (files: FileList) => {
    const fileArray = Array.from(files);
    const newPairs: Record<string, Partial<FilePair>> = {};

    // Helper to clean filename and extract codename
    // e.g., "1.in" -> "1", "test.out" -> "test"
    const getCodename = (name: string) => {
      return name.replace(/\.(in|out|inp|sol)$/, '');
    };

    fileArray.forEach(file => {
      const codename = getCodename(file.name);
      
      if (!newPairs[codename]) {
        newPairs[codename] = { codename };
      }

      if (file.name.endsWith('.in') || file.name.endsWith('.inp')) {
        newPairs[codename].input = file;
      } else if (file.name.endsWith('.out') || file.name.endsWith('.sol')) {
        newPairs[codename].output = file;
      }
    });

    // Merge with existing pairs or just replace? Let's replace for simplicity
    const processedPairs: FilePair[] = Object.values(newPairs).map(p => {
      const pair = p as FilePair;
      if (!pair.input) pair.status = 'missing_input';
      else if (!pair.output) pair.status = 'missing_output';
      else pair.status = 'ready';
      return pair;
    });

    setPairs(processedPairs.sort((a, b) => a.codename.localeCompare(b.codename, undefined, { numeric: true })));
  };

  const toBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result.split(',')[1]);
        } else {
          reject(new Error('Failed to convert file'));
        }
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleUpload = async () => {
    const readyPairs = pairs.filter(p => p.status === 'ready');
    if (readyPairs.length === 0) return;

    setLoading(true);
    setUploadProgress(0);

    try {
      // Process binaries in parallel? typically safe for browser but limited memory
      const uploadData = await Promise.all(readyPairs.map(async (pair) => {
        return {
          codename: pair.codename,
          inputBase64: await toBase64(pair.input!),
          outputBase64: await toBase64(pair.output!),
          isPublic: false
        };
      }));

      const result = await batchUploadTestcases(datasetId, uploadData);

      if (result.success) {
        onSuccess();
        onClose();
        setPairs([]);
      } else {
        alert('Upload failed: ' + result.error);
      }
    } catch (error) {
      console.error(error);
      alert('An unexpected error occurred during upload.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="relative z-10 w-full max-w-2xl h-[80vh] bg-neutral-900 border border-white/10 rounded-xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">Upload Testcases</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div 
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-white/10 rounded-xl p-8 flex flex-col items-center justify-center gap-2 hover:bg-white/5 hover:border-cyan-500/50 transition-all cursor-pointer group"
          >
            <Upload className="w-8 h-8 text-neutral-500 group-hover:text-cyan-400 transition-colors" />
            <p className="text-neutral-400 font-medium">Click to select files</p>
            <p className="text-xs text-neutral-600">Supports .in/.out pairs. Names must match.</p>
            <input 
              ref={fileInputRef}
              type="file" 
              multiple 
              className="hidden" 
              accept=".in,.out,.inp,.sol"
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
            />
          </div>

          {pairs.length > 0 && (
            <div className="space-y-2">
               <div className="flex items-center justify-between text-xs text-neutral-500 uppercase font-bold px-2">
                 <span>Files ({pairs.length})</span>
                 <span>Status</span>
               </div>
               
               {pairs.map((pair) => (
                 <div key={pair.codename} className="flex items-center justify-between p-3 bg-black/30 rounded-lg border border-white/5">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-neutral-400" />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-white">{pair.codename}</span>
                        <span className="text-xs text-neutral-500">
                          {pair.input ? pair.input.name : 'Missing Input'} • {pair.output ? pair.output.name : 'Missing Output'}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {pair.status === 'ready' && <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">Ready</span>}
                      {pair.status === 'missing_input' && <span className="text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded">Missing .in</span>}
                      {pair.status === 'missing_output' && <span className="text-xs text-orange-400 bg-orange-500/10 px-2 py-1 rounded">Missing .out</span>}
                    </div>
                 </div>
               ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-white/10 bg-black/40 flex justify-end gap-3 shrink-0">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-transparent hover:bg-white/5 text-neutral-300 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={loading || pairs.filter(p => p.status === 'ready').length === 0}
            className="px-6 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {loading && <Loader className="w-4 h-4 animate-spin" />}
            Upload {pairs.filter(p => p.status === 'ready').length} Pairs
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
