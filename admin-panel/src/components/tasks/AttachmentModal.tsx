'use client';

import { useState, useEffect } from 'react';
import { X, Paperclip, Upload, Loader } from 'lucide-react';
import { addAttachment } from '@/app/actions/statements';

interface AttachmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: number;
  onSuccess: () => void;
}

export function AttachmentModal({ isOpen, onClose, taskId, onSuccess }: AttachmentModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [customFilename, setCustomFilename] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      if (!customFilename) {
        setCustomFilename(selectedFile.name);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a file');
      return;
    }

    const filename = customFilename.trim() || file.name;
    if (!filename) {
      setError('Please provide a filename');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        const result = await addAttachment(taskId, filename, base64);
        
        if (result.success) {
          onSuccess();
          onClose();
          setFile(null);
          setCustomFilename('');
        } else {
          setError(result.error || 'Failed to upload attachment');
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      
      <div className="relative z-10 w-full max-w-md mx-4 bg-neutral-900 border border-white/10 rounded-xl shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Paperclip className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg font-bold text-white">Add Attachment</h2>
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
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">File</label>
            <div className="relative">
              <input
                type="file"
                onChange={handleFileChange}
                className="hidden"
                id="attachment-file"
              />
              <label
                htmlFor="attachment-file"
                className="flex items-center justify-center gap-2 w-full px-4 py-8 bg-black/30 border border-dashed border-white/20 rounded-lg text-neutral-400 cursor-pointer hover:bg-black/50 hover:border-purple-500/30 transition-colors"
              >
                <Upload className="w-5 h-5" />
                {file ? file.name : 'Click to select file'}
              </label>
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-bold text-neutral-500 uppercase mb-2">
              Filename (as shown to contestants)
            </label>
            <input
              type="text"
              value={customFilename}
              onChange={(e) => setCustomFilename(e.target.value)}
              placeholder="e.g., sample_data.zip"
              className="w-full px-4 py-3 bg-black/50 border border-white/10 rounded-lg text-white focus:outline-none focus:border-indigo-500/50"
            />
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
              className="flex-1 px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                'Upload Attachment'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
