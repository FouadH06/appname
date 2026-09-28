'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useBiz } from '@/lib/biz/context';
import { navFor, type NavItem } from '@/lib/biz/nav';
import { t } from '@/lib/copy';
import { supabase } from '@/lib/supabase';

function isActive(pathname: string, base: string, item: NavItem) {
  return item.path === '' ? pathname === base : pathname.startsWith(base + item.path);
}

/** Dashboard shell: sidebar ≥1024, icon rail 768–1023, bottom bar <768 (Phase 2 §8.4). */
export function BizShell({ children }: { children: ReactNode }) {
  const { business, role } = useBiz();
  const pathname = usePathname();
  const router = useRouter();
  const base = `/biz/${business.id}`;
  const items = useMemo(() => navFor(role, business.status === 'draft'), [role, business.status]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const bottom = items.filter((i) => i.bottom);
  const more = items.filter((i) => !i.bottom);
  const signOut = () =>
    void supabase()
      .auth.signOut()
      .then(() => router.replace('/biz/login'));

  return (
    <div className="min-h-dvh bg-surface-50 text-ink-900 md:flex">
      <aside
        className="hidden shrink-0 border-e border-line-200 bg-surface-0 md:flex md:w-16 md:flex-col lg:w-60"
        aria-label="Business navigation"
      >
        <div className="flex h-14 items-center gap-2 border-b border-line-200 px-3">
          <span className="grid size-8 shrink-0 place-items-center rounded-control bg-accent-600 text-sm font-bold text-white">
            {business.name.slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden truncate font-semibold lg:block" data-testid="biz-name">
            {business.name}
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-2">
          {items.map((item) => (
            <Link
              key={item.key}
              href={base + item.path}
              title={item.label}
              aria-current={isActive(pathname, base, item) ? 'page' : undefined}
              className="flex items-center gap-3 rounded-control px-3 py-2 text-sm text-ink-700 hover:bg-surface-100 aria-[current=page]:bg-surface-100 aria-[current=page]:font-semibold aria-[current=page]:text-ink-900"
            >
              <span aria-hidden className="w-5 text-center">
                {item.icon}
              </span>
              <span className="hidden lg:inline">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="flex flex-col border-t border-line-200 p-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden rounded-control px-3 py-2 text-start text-sm text-ink-500 hover:bg-surface-100 lg:block"
          >
            Search… <kbd className="ms-1 text-xs">Ctrl K</kbd>
          </button>
          <Link
            href="/biz"
            className="hidden rounded-control px-3 py-2 text-sm text-ink-500 hover:bg-surface-100 lg:block"
          >
            Switch business
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="rounded-control px-3 py-2 text-start text-sm text-ink-500 hover:bg-surface-100"
            title={t.auth.signOut}
          >
            <span className="lg:hidden" aria-hidden>
              ⎋
            </span>
            <span className="hidden lg:inline">{t.auth.signOut}</span>
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-line-200 bg-surface-0 px-4 md:hidden">
        <span className="truncate font-semibold">{business.name}</span>
        <Link href="/biz" className="text-sm text-accent-600">
          Switch
        </Link>
      </header>

      <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>

      {/* Mobile: Today · Calendar · [+] · Customers · More */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-line-200 bg-surface-0 md:hidden"
        aria-label="Business navigation (mobile)"
      >
        {bottom.slice(0, 2).map((item) => (
          <BottomLink
            key={item.key}
            item={item}
            base={base}
            active={isActive(pathname, base, item)}
          />
        ))}
        <Link
          href={`${base}/calendar?new=1`}
          className="m-1 grid place-items-center rounded-full bg-accent-600 text-2xl text-white"
          aria-label="New appointment"
        >
          ＋
        </Link>
        {bottom.slice(2, 3).map((item) => (
          <BottomLink
            key={item.key}
            item={item}
            base={base}
            active={isActive(pathname, base, item)}
          />
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          className="flex flex-col items-center py-2 text-xs text-ink-700"
          aria-expanded={moreOpen}
        >
          <span aria-hidden>⋯</span>More
        </button>
      </nav>
      {moreOpen ? (
        <div
          className="fixed inset-x-0 bottom-14 z-30 border-t border-line-200 bg-surface-0 p-2 shadow-lg md:hidden"
          role="menu"
        >
          {more.map((item) => (
            <Link
              key={item.key}
              href={base + item.path}
              onClick={() => setMoreOpen(false)}
              className="block rounded-control px-3 py-3 text-sm"
              role="menuitem"
            >
              {item.icon} {item.label}
            </Link>
          ))}
          <button
            type="button"
            onClick={signOut}
            className="block w-full rounded-control px-3 py-3 text-start text-sm"
            role="menuitem"
          >
            {t.auth.signOut}
          </button>
        </div>
      ) : null}

      {paletteOpen ? (
        <CommandPalette items={items} base={base} onClose={() => setPaletteOpen(false)} />
      ) : null}
    </div>
  );
}

function BottomLink({ item, base, active }: { item: NavItem; base: string; active: boolean }) {
  return (
    <Link
      href={base + item.path}
      aria-current={active ? 'page' : undefined}
      className="flex flex-col items-center py-2 text-xs text-ink-700 aria-[current=page]:font-semibold aria-[current=page]:text-accent-600"
    >
      <span aria-hidden>{item.icon}</span>
      {item.label}
    </Link>
  );
}

// Command palette skeleton (M5): jump to a section or search customers. Bookings search: M6.
function CommandPalette({
  items,
  base,
  onClose,
}: {
  items: NavItem[];
  base: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const matches = items.filter((i) => i.label.toLowerCase().includes(q.toLowerCase()));
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  const searchHref = `${base}/customers?q=${encodeURIComponent(q.trim())}`;
  return (
    <div className="fixed inset-0 z-40 bg-black/30 p-4 pt-24" onClick={onClose}>
      <div
        className="mx-auto w-full max-w-lg rounded-card border border-line-200 bg-surface-0 shadow-xl"
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            if (matches[0]) go(base + matches[0].path);
            else if (q.trim()) go(searchHref);
          }}
          placeholder="Go to… or search customers by name/phone"
          className="h-12 w-full border-b border-line-200 bg-transparent px-4 outline-none"
        />
        <ul className="max-h-80 overflow-auto p-2">
          {matches.map((i) => (
            <li key={i.key}>
              <button
                type="button"
                onClick={() => go(base + i.path)}
                className="w-full rounded-control px-3 py-2 text-start text-sm hover:bg-surface-100"
              >
                {i.icon} {i.label}
              </button>
            </li>
          ))}
          {q.trim() ? (
            <li>
              <button
                type="button"
                onClick={() => go(searchHref)}
                className="w-full rounded-control px-3 py-2 text-start text-sm hover:bg-surface-100"
              >
                Search customers for “{q.trim()}”
              </button>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
