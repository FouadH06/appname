'use client';

import { Turnstile } from '@app/ui-web';
import { getPublicEnv } from '@/env';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

export function CaptchaBridge() {
  return (
    <div data-testid="captcha-bridge">
      <Turnstile
        siteKey={getPublicEnv().NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        onToken={(token) => {
          if (!token) return;
          const msg = JSON.stringify({ type: 'captcha', token });
          window.ReactNativeWebView?.postMessage(msg);
          if (window.parent !== window) window.parent.postMessage(msg, '*');
        }}
      />
    </div>
  );
}
