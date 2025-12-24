'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  addToast: (message: string, type: ToastType) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      {/* Portals need to check for document presence for SSR safety if directly rendered, 
          but usually in useEffect or check window. Here we wrap in a client-only check implicitly by being a Client Component */}
      {typeof document !== 'undefined' && createPortal(
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={cn(
                "pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border backdrop-blur-md animate-in slide-in-from-right-full duration-300 min-w-[300px]",
                toast.type === 'success' && "bg-green-500/10 border-green-500/20 text-green-200",
                toast.type === 'error' && "bg-red-500/10 border-red-500/20 text-red-200",
                toast.type === 'warning' && "bg-yellow-500/10 border-yellow-500/20 text-yellow-200",
                toast.type === 'info' && "bg-blue-500/10 border-blue-500/20 text-blue-200",
              )}
            >
              {toast.type === 'success' && <CheckCircle className="w-5 h-5 text-green-500" />}
              {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
              {toast.type === 'warning' && <AlertTriangle className="w-5 h-5 text-yellow-500" />}
              {toast.type === 'info' && <Info className="w-5 h-5 text-blue-500" />}
              
              <p className="text-sm font-medium flex-1">{toast.message}</p>
              
              <button
                onClick={() => removeToast(toast.id)}
                className="p-1 rounded-full hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4 opacity-70 hover:opacity-100" />
              </button>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
};
