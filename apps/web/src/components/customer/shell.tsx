'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { IconCalendar, IconHeart, IconHome, IconSearch, IconUser } from './icons';
import { BRAND, container } from './layout';

// Customer shell (UX pass): one responsive frame for the conversion spine. Phones and tablets get the
// bottom tab bar (Home · Search · Bookings · Favorites · Profile); from 1024 px it becomes a header
// navigation. The product name comes from the i18n catalogue (placeholder until branding).

export const NAV = [
  { href: '/', label: 'Home', icon: IconHome, match: (p: string) => p === '/' },
  {
    href: '/search',
    label: 'Search',
    icon: IconSearch,
    match: (p: string) => p.startsWith('/search') || p.startsWith('/explore'),
  },
  {
    href: '/bookings',
    label: 'Bookings',
    icon: IconCalendar,
    match: (p: string) => p.startsWith('/bookings'),
  },
  {
    href: '/favorites',
    label: 'Favorites',
    icon: IconHeart,
    match: (p: string) => p.startsWith('/favorites'),
  },
  {
    href: '/account',
    label: 'Profile',
    icon: IconUser,
    match: (p: string) => p.startsWith('/account'),
  },
] as const;

export function Wordmark({ tagline = false }: { tagline?: boolean }) {
  return (
    <Link href="/" className="flex flex-col leading-none" aria-label={`${BRAND} home`}>
      <span className="text-[26px] font-bold tracking-tight text-accent-600">{BRAND}</span>
      {tagline ? (
        <span className="mt-1 text-xs text-ink-500">Local services, booked in a minute.</span>
      ) : null}
    </Link>
  );
}

export function CustomerShell({
  children,
  mobileHeader = true,
  mobileNav = true,
  headerExtra,
}: {
  children: ReactNode;
  /** phone/tablet top bar (hidden on pages with their own header, e.g. the business gallery) */
  mobileHeader?: boolean;
  /** phone/tablet bottom tabs (hidden in the booking flow, which has a sticky action instead) */
  mobileNav?: boolean;
  /** right side of the header (e.g. area picker) */
  headerExtra?: ReactNode;
}) {
  const path = usePathname() ?? '/';
  return (
    <div data-surface="customer" className="flex min-h-dvh flex-col overflow-x-clip">
      <header
        className={`sticky top-0 z-30 border-b border-line-200 bg-surface-50/95 backdrop-blur ${mobileHeader ? '' : 'hidden lg:block'}`}
      >
        <div className={`${container} flex h-14 items-center gap-6 lg:h-16`}>
          <Wordmark />
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {NAV.slice(0, 4).map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={n.match(path) ? 'page' : undefined}
                className={`rounded-control px-3 py-2 text-sm font-medium ${n.match(path) ? 'bg-accent-50 text-accent-600' : 'text-ink-700 hover:bg-surface-100'}`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            {headerExtra}
            <Link
              href="/account"
              aria-current={path.startsWith('/account') ? 'page' : undefined}
              className="hidden h-10 items-center gap-2 rounded-full border border-line-200 bg-surface-0 px-3 text-sm font-medium lg:flex"
            >
              <IconUser size={18} /> Profile
            </Link>
          </div>
        </div>
      </header>

      <div
        className={`flex-1 ${mobileNav ? 'pb-[calc(68px+env(safe-area-inset-bottom))] lg:pb-0' : ''}`}
      >
        {children}
      </div>

      {mobileNav ? (
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line-200 bg-surface-0 pb-[env(safe-area-inset-bottom)] lg:hidden"
          data-testid="bottom-nav"
        >
          <ul className="mx-auto grid max-w-xl grid-cols-5">
            {NAV.map((n) => {
              const on = n.match(path);
              const Icon = n.icon;
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={on ? 'page' : undefined}
                    className={`flex h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium ${on ? 'text-accent-600' : 'text-ink-500'}`}
                  >
                    <Icon size={22} />
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
