'use client';

import { useEffect, useRef } from 'react';

// Cloudflare Turnstile (bot protection on OTP send and anonymous sign-in, review decision 2026-09-28).
// Local/CI use Cloudflare's official test site key 1x00000000000000000000AA (always passes).

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('turnstile script failed to load'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface TurnstileProps {
  siteKey: string;
  /** Receives a fresh single-use token, or null when it expires or fails. */
  onToken: (token: string | null) => void;
  /** Change this value to request a new token (tokens are single-use). */
  resetKey?: number;
  action?: string;
}

export function Turnstile({ siteKey, onToken, resetKey = 0, action }: TurnstileProps) {
  const el = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenCb = useRef(onToken);
  useEffect(() => {
    tokenCb.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !el.current || !window.turnstile || widget.current) return;
        widget.current = window.turnstile.render(el.current, {
          sitekey: siteKey,
          action,
          appearance: 'interaction-only', // invisible unless Cloudflare needs the user
          callback: (t: string) => tokenCb.current(t),
          'expired-callback': () => tokenCb.current(null),
          'error-callback': () => tokenCb.current(null),
        });
      })
      .catch(() => tokenCb.current(null));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (resetKey > 0 && widget.current && window.turnstile) {
      tokenCb.current(null);
      window.turnstile.reset(widget.current);
    }
  }, [resetKey]);

  return <div ref={el} data-testid="turnstile" />;
}
