import type { Metadata } from 'next';
import { CaptchaBridge } from './bridge';

// M13: Turnstile for the customer app. The app loads this page in a WebView (native) or an iframe (web
// build) and receives the single-use token by message, so the widget runs on our own domain (the site
// key's allowed hostname) on every platform. Nothing else is on the page.
export const metadata: Metadata = { title: 'Verification', robots: { index: false } };

export default function CaptchaPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-0 p-4">
      <CaptchaBridge />
    </main>
  );
}
