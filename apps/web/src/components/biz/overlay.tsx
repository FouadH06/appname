'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Right-hand drawer on desktop (420 px, the calendar stays visible), full-screen sheet on
 * phones (Phase 2 B4). Esc closes.
 */
export function Drawer({
  title,
  onClose,
  children,
  footer,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 hidden bg-ink-900/20 md:block"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="relative flex h-full w-full flex-col bg-surface-0 shadow-xl md:w-[420px] md:border-l md:border-line-200"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line-200 px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-9 w-9 rounded-control text-ink-500 hover:bg-surface-50"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? <footer className="border-t border-line-200 px-4 py-3">{footer}</footer> : null}
      </aside>
    </div>
  );
}

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'danger' | 'success';
  action?: { label: string; run: () => void };
}

/** Transient messages ("Saved · Undo", "New booking from APP_NAME: …"). */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>, ms = 5000) => {
      const id = ++seq.current;
      setToasts((list) => [...list.slice(-2), { ...t, id }]);
      window.setTimeout(() => dismiss(id), ms);
      return id;
    },
    [dismiss],
  );
  return { toasts, push, dismiss };
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          data-testid="toast"
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-control px-4 py-2.5 text-sm shadow-lg ${
            t.tone === 'danger' ? 'bg-danger-600 text-white' : 'bg-ink-900 text-white'
          }`}
        >
          <span>{t.text}</span>
          {t.action ? (
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
