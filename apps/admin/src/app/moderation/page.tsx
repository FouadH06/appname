'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { messageForCode } from '@app/i18n';
import { MODERATION_ROLES, useAdminGate } from '@/lib/gate';
import { supabase } from '@/lib/supabase';

// A2 Moderation queue (minimal, M9): open cases by priority — the text pipeline's unsure cases,
// reports, and fraud investigations. SLA shown per case.

interface CaseRow {
  id: string;
  subject_type: string;
  source: 'pipeline' | 'report' | 'appeal' | 'fraud';
  reasons: string[];
  priority: number;
  state: string;
  claimed_by_me: boolean;
  created_at: string;
  sla_due_at: string;
  business: string | null;
  snippet: string | null;
}

const SOURCE: Record<CaseRow['source'], string> = {
  pipeline: 'Automatic check',
  report: 'Report',
  appeal: 'Appeal',
  fraud: 'Fraud check',
};
const STATES: [string, string][] = [
  ['open', 'Open'],
  ['escalated', 'Escalated'],
  ['decided', 'Decided'],
];
const due = (iso: string) => {
  const h = Math.round((new Date(iso).getTime() - new Date().getTime()) / 3_600_000);
  return h < 0 ? `overdue ${-h} h` : `due in ${h} h`;
};

export default function ModerationQueue() {
  const access = useAdminGate(MODERATION_ROLES);
  const [state, setState] = useState('open');
  const [rows, setRows] = useState<CaseRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!access) return;
    let alive = true;
    void supabase()
      .rpc('admin_list_cases', { p_state: state })
      .then(({ data, error: e }) => {
        if (!alive) return;
        if (e) setError(messageForCode('en', e.message));
        else setRows((data as unknown as CaseRow[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [access, state]);

  if (!access) return null;
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/" className="text-sm text-accent-600">
        ← Admin
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Moderation queue</h1>
      <div className="mt-4 flex gap-2" role="tablist">
        {STATES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={state === key}
            className={`rounded-full border px-3 py-1 text-sm ${
              state === key ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200'
            }`}
            onClick={() => {
              setRows(null);
              setState(key);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? <p className="mt-4 text-sm text-danger-600">{error}</p> : null}
      {!rows ? (
        <p className="mt-4 text-sm text-ink-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-ink-700" data-testid="queue-empty">
          Nothing here.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-line-200 rounded-card border border-line-200">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={
                  c.subject_type.endsWith('_media')
                    ? `/moderation/media/${c.id}`
                    : `/moderation/${c.id}`
                }
                className="flex flex-col gap-1 p-3 hover:bg-surface-50"
                data-testid="case-row"
              >
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{SOURCE[c.source]}</span>
                  <span className="text-ink-500">· {c.subject_type.replace('_', ' ')}</span>
                  <span className="text-ink-500">· {c.business}</span>
                  <span className="text-ink-500">· priority {c.priority}</span>
                  {c.state === 'claimed' ? (
                    <span className="rounded-full bg-surface-100 px-2 text-xs">
                      {c.claimed_by_me ? 'claimed by you' : 'claimed'}
                    </span>
                  ) : null}
                  <span className="ms-auto text-xs text-ink-500">{due(c.sla_due_at)}</span>
                </span>
                {c.snippet ? (
                  <span className="line-clamp-2 text-sm text-ink-700" dir="auto">
                    {c.snippet}
                  </span>
                ) : null}
                <span className="text-xs text-ink-500">{c.reasons.join(', ')}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
