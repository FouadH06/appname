'use client';

import { useState } from 'react';
import type { Direction } from '@app/i18n';

type Theme = 'system' | 'light' | 'dark';

export function FoundationControls() {
  const [dir, setDir] = useState<Direction>('ltr');
  const [theme, setTheme] = useState<Theme>('system');

  function toggleDir() {
    const next: Direction = dir === 'ltr' ? 'rtl' : 'ltr';
    document.documentElement.dir = next;
    setDir(next);
  }

  function cycleTheme() {
    const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    if (next === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    setTheme(next);
  }

  return (
    <div className="mt-6 flex gap-3">
      <button
        type="button"
        onClick={toggleDir}
        className="rounded-control bg-ink-900 px-4 py-2 text-surface-0"
      >
        Direction: {dir.toUpperCase()}
      </button>
      <button
        type="button"
        onClick={cycleTheme}
        className="rounded-control border border-line-200 bg-surface-0 px-4 py-2"
      >
        Theme: {theme}
      </button>
    </div>
  );
}
