'use client';

import { useState, useEffect } from 'react';
import { X, FileText, Upload, Loader } from 'lucide-react';
import { Portal } from '../core/Portal';
import { apiClient } from '@/lib/apiClient';
import { STATEMENT_LANGUAGES } from '@/lib/constants';

interface StatementModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
  existingLanguages: string[];
  onSuccess: () => void;
}

export function StatementModal({ isOpen, onClose, taskId, existingLanguages, onSuccess }: StatementModalProps) {
  const [language, setLanguage] = useState('en');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Filter out languages that already have statements
  const availableLanguages = STATEMENT_LANGUAGES.filter(
    l => !existingLanguages.includes(l.code) || l.code === language
  );

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const result = await apiClient.post('/api/statements', {
          taskId,
          language,
          fileData: base64
        });
        
        if (result.success) {
          onSuccess();
          onClose();
          setFile(null);
        } else {
          setError(result.error || 'Failed to upload statement');
        }
        setLoading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError('An unexpected error occurred');
      setLoading(false);
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-black/80 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="relative z-10 w-full max-w-md mx-4 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-bold text-white">Add Statement</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-lg transition-colors">
            <X className="w-5 h-5 text-neutral-400" />
          </button>
        </div>
        
        {error && (
          <div className="mx-4 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
            >
              {availableLanguages.map(lang => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} ({lang.code})
                </option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">PDF File</label>
            <div className="relative">
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
                id="statement-file"
              />
              <label
                htmlFor="statement-file"
                className="flex items-center justify-center gap-2 w-full px-4 py-8 bg-black/30 border border-dashed border-white/20 rounded-lg text-neutral-400 cursor-pointer hover:bg-black/50 hover:border-emerald-500/30 transition-colors"
              >
                <Upload className="w-5 h-5" />
                {file ? file.name : 'Click to select PDF file'}
              </label>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !file}
              className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                'Upload Statement'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
    </Portal>
  );
}
