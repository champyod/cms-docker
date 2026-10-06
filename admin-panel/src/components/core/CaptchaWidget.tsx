'use client';

import { useEffect, useRef } from 'react';
import { ShieldCheck } from 'lucide-react';
import type { CaptchaProvider } from '@/lib/captcha';

declare global {
  interface Window {
    onCaptchaSuccess?: (token: string) => void;
    onCaptchaExpired?: () => void;
    turnstile?: { render: (el: string | HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void };
    hcaptcha?: { render: (el: string | HTMLElement, opts: Record<string, unknown>) => string; reset: () => void };
  }
}

export function CaptchaWidget({
  provider,
  siteKey,
  onToken,
}: {
  provider: CaptchaProvider;
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (!siteKey || renderedRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    const tryRender = () => {
      if (renderedRef.current) return;
      if (provider === 'turnstile' && window.turnstile && container) {
        container.innerHTML = '';
        try {
          window.turnstile.render(container, {
            sitekey: siteKey,
            callback: (token: string) => onToken(token),
            'expired-callback': () => onToken(''),
            'error-callback': () => onToken(''),
            theme: 'dark',
          });
          renderedRef.current = true;
        } catch {
          container.innerHTML = `<div class="cf-turnstile" data-sitekey="${siteKey}" data-callback="onCaptchaSuccess" data-expired-callback="onCaptchaExpired"></div>`;
        }
        return;
      }
      if (provider === 'hcaptcha' && window.hcaptcha && container) {
        container.innerHTML = '';
        try {
          window.hcaptcha.render(container, {
            sitekey: siteKey,
            callback: (token: string) => onToken(token),
            'expired-callback': () => onToken(''),
            'error-callback': () => onToken(''),
            theme: 'dark',
          });
          renderedRef.current = true;
        } catch {
          container.innerHTML = `<div class="h-captcha" data-sitekey="${siteKey}" data-callback="onCaptchaSuccess" data-expired-callback="onCaptchaExpired"></div>`;
        }
      }
    };

    const interval = window.setInterval(tryRender, 300);
    tryRender();
    return () => window.clearInterval(interval);
  }, [provider, siteKey, onToken]);

  if (provider === 'turnstile') {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Security check required</span>
        </div>
        <div ref={containerRef} className="min-h-16 flex items-center justify-center">
          <div className="cf-turnstile" data-sitekey={siteKey} data-callback="onCaptchaSuccess" data-expired-callback="onCaptchaExpired" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span>Security check required</span>
      </div>
      <div ref={containerRef} className="min-h-16 flex items-center justify-center">
        <div className="h-captcha" data-sitekey={siteKey} data-callback="onCaptchaSuccess" data-expired-callback="onCaptchaExpired" />
      </div>
    </div>
  );
}
