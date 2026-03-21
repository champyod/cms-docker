'use client';

/**
 * DEPRECATED: This file is kept for backward compatibility only.
 * 
 * USE THIS INSTEAD:
 *   import { useToast } from '@/components/providers/ToastProvider';
 * 
 * The ToastProvider in components/providers/ is the canonical implementation
 * with proper glassmorphic theming, accessibility, and supports title + message.
 */

export { useToast, ToastProvider, type ToastType } from '@/components/providers/ToastProvider';
