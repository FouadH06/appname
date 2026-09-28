import type { ReactNode } from 'react';

export function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-card border border-line-200 bg-surface-0 p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-ink-700">{subtitle}</div> : null}
        <div className="mt-6 flex flex-col gap-4">{children}</div>
      </div>
    </main>
  );
}

export const primaryButton =
  'h-12 w-full rounded-control bg-accent-600 px-4 text-base font-semibold text-white disabled:opacity-50';
export const secondaryButton =
  'h-12 w-full rounded-control border border-line-200 bg-surface-0 px-4 text-base font-medium text-ink-900 disabled:opacity-50';
