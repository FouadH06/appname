'use client';

import type { ReactNode } from 'react';

// Small building blocks for dashboard screens (tokens from @app/ui-web).

export const input =
  'h-11 w-full rounded-control border border-line-200 bg-surface-0 px-3 text-sm text-ink-900 outline-none focus:border-accent-600 disabled:opacity-60';
export const btn = {
  primary:
    'inline-flex h-10 items-center justify-center gap-2 rounded-control bg-accent-600 px-4 text-sm font-semibold text-white disabled:opacity-50',
  secondary:
    'inline-flex h-10 items-center justify-center gap-2 rounded-control border border-line-200 bg-surface-0 px-4 text-sm font-medium text-ink-900 disabled:opacity-50',
  danger:
    'inline-flex h-10 items-center justify-center gap-2 rounded-control border border-danger-600 px-4 text-sm font-medium text-danger-600 disabled:opacity-50',
  link: 'text-sm font-medium text-accent-600 hover:underline disabled:opacity-50',
};

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-200 bg-surface-0 px-4 py-4 md:px-6">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-line-200 bg-surface-0 p-4 md:p-5">
      <h2 className="font-semibold">{title}</h2>
      {description ? <p className="mt-0.5 text-sm text-ink-500">{description}</p> : null}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? (
        <span className="text-danger-600" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="text-ink-500">{hint}</span>
      ) : null}
    </label>
  );
}

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start justify-between gap-4 text-sm">
      <span>
        <span className="font-medium">{label}</span>
        {description ? <span className="block text-ink-500">{description}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-5 accent-[var(--accent-600)]"
      />
    </label>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'danger' | 'success' | 'warning';
  children: ReactNode;
}) {
  const color = {
    info: 'border-info-600 text-ink-900',
    danger: 'border-danger-600 text-danger-600',
    success: 'border-success-600 text-ink-900',
    warning: 'border-warning-600 text-ink-900',
  }[tone];
  return (
    <div
      className={`rounded-control border-s-4 bg-surface-0 px-3 py-2 text-sm ${color}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 md:p-6">{children}</div>;
}

export function ComingSoon({
  title,
  milestone,
  detail,
}: {
  title: string;
  milestone: string;
  detail: string;
}) {
  return (
    <>
      <PageHeader title={title} />
      <Body>
        <Notice>
          {detail} <span className="text-ink-500">(arrives in {milestone})</span>
        </Notice>
      </Body>
    </>
  );
}

/** Error code from an RPC/PostgREST error (P0001 stable codes). */
export function codeOf(e: unknown): string {
  const err = (e ?? {}) as { code?: string; message?: string };
  if (err.code === 'P0001' && err.message) return err.message;
  if (err.code === '42501') return 'FORBIDDEN';
  if (err.code === '23505') return 'DUPLICATE';
  return err.message && /^[A-Z_]+$/.test(err.message) ? err.message : 'UNKNOWN';
}
