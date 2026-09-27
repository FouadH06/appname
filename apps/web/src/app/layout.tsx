import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DEFAULT_LOCALE, getDirection } from '@app/i18n';
import './globals.css';

export const metadata: Metadata = {
  title: 'APP_NAME',
  description: 'Find, trust and book local services in Lebanon.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LOCALE} dir={getDirection(DEFAULT_LOCALE)}>
      <body>{children}</body>
    </html>
  );
}
