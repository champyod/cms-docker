'use client';

import React, { createContext, useCallback, useContext, type ReactNode } from 'react';
import { toast, type ExternalToast } from 'sonner';
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // In ms. If Infinity or 0, it doesn't auto-hide.
  action?: ToastAction;
}

interface ToastContextType {
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

interface ToastPublisher {
  success(title: string, data?: ExternalToast): unknown;
  error(title: string, data?: ExternalToast): unknown;
  warning(title: string, data?: ExternalToast): unknown;
  info(title: string, data?: ExternalToast): unknown;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const TOAST_ICONS: Record<ToastType, LucideIcon> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const TOAST_ICON_CLASSES: Record<ToastType, string> = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-cyan-400',
};

const DEFAULT_TOAST_DURATION_MS = 5000;

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function resolveToastDuration(duration?: number): number {
  if (duration === undefined) return DEFAULT_TOAST_DURATION_MS;
  return duration > 0 && duration !== Infinity ? duration : Infinity;
}

function generateToastId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function createToastIcon(type: ToastType): ReactNode {
  const Icon = TOAST_ICONS[type];
  return <Icon className={cn('w-5 h-5', TOAST_ICON_CLASSES[type])} />;
}

export function buildToastOptions(input: Omit<Toast, 'id'>, id: string): ExternalToast {
  return {
    id,
    description: input.message,
    duration: resolveToastDuration(input.duration),
    icon: createToastIcon(input.type),
    action: input.action,
  };
}

export function dispatchToast(publisher: ToastPublisher, input: Omit<Toast, 'id'>): string {
  const id = generateToastId();
  publisher[input.type](input.title, buildToastOptions(input, id));
  return id;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const addToast = useCallback((input: Omit<Toast, 'id'>) => {
    dispatchToast(toast, input);
  }, []);

  const removeToast = useCallback((id: string) => {
    toast.dismiss(id);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}
