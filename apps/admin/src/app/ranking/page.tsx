'use client';

import { useState } from 'react';
import {
  ActionDialog,
  Badge,
  Card,
  Shell,
  State,
  Table,
  field,
  fmt,
  statusTone,
  useData,
} from '@/components/ui';
import { RANKING_ROLES, useAdminGate } from '@/lib/gate';
import { reasons } from '@/lib/reasons';
import { supabase } from '@/lib/supabase';

// A9 Ranking configuration: versions, draft editor (quality weights must sum to 100), publish /
// rollback (superadmin), "why this rank" inspector. Scores themselves are computed from M12.
// Changing weights never changes displayed ratings (display mean ≠ ranking score by design).

type Params = {
  quality_weights: Record<string, number>;
  query: Record<string, number>;
  [k: string]: unknown;
};
interface Version {
  version: number;
  status: string;
  params: Params;
  reason: string | null;
  created_at: string;
  published_at: string | null;
  author: string | null;
}
interface Biz {
  id: string;
  name: string;
}

const WEIGHTS = ['rating', 'volume', 'recent', 'reliability', 'completeness', 'responsiveness'];
const QUERY = ['quality', 'proximity', 'availability', 'personal'];

export default function RankingPage() {
  const access = useAdminGate(RANKING_ROLES);
  const { data, error, loading, reload } = useData<Version[]>(
    () => supabase().rpc('admin_list_ranking_configs'),
    [],
  );
  if (!access) return null;
  const superadmin = access.admin_role === 'superadmin';
  const active = data?.find((v) => v.status === 'active');
  return (
    <Shell access={access} title="Ranking configuration">
      <State loading={loading && !data} error={error} />
      {data ? (
        <Card title="Versions">
          <Table
            rows={data}
            testId="ranking-versions"
            cols={[
              ['Version', (v) => `v${v.version}`],
              [
                'Status',
                (v) => (
                  <Badge tone={v.status === 'active' ? 'good' : statusTone(v.status)}>
                    {v.status}
                  </Badge>
                ),
              ],
              ['Reason', (v) => v.reason ?? '—'],
              ['Author', (v) => v.author ?? 'seed'],
              ['Created', (v) => fmt(v.created_at)],
              ['Published', (v) => fmt(v.published_at)],
              [
                'Weights',
                (v) => (
                  <span className="text-xs">
                    {WEIGHTS.map((k) => `${k} ${v.params.quality_weights[k]}`).join(' · ')}
                  </span>
                ),
              ],
              [
                '',
                (v) =>
                  superadmin && v.status !== 'active' ? (
                    <ActionDialog
                      label={v.status === 'archived' ? 'Roll back to this' : 'Publish'}
                      title={`${v.status === 'archived' ? 'Roll back to' : 'Publish'} v${v.version}`}
                      reasons={reasons('ranking')}
                      testId={`publish-v${v.version}`}
                      run={(reason) =>
                        v.status === 'archived'
                          ? supabase().rpc('admin_rollback_ranking', {
                              p_version: v.version,
                              p_reason: reason,
                            })
                          : supabase().rpc('admin_publish_ranking', {
                              p_version: v.version,
                              p_reason: reason,
                            })
                      }
                      onDone={() => void reload()}
                    >
                      <p className="text-sm text-ink-700">
                        The active version switches at once (v{active?.version} is archived).
                        Recompute arrives with search (M12).
                      </p>
                    </ActionDialog>
                  ) : null,
              ],
            ]}
          />
        </Card>
      ) : null}
      {superadmin && active ? <DraftEditor base={active} done={() => void reload()} /> : null}
      <Inspector />
      <SearchDebugger />
    </Shell>
  );
}

function DraftEditor({ base, done }: { base: Version; done: () => void }) {
  const [w, setW] = useState<Record<string, number>>({ ...base.params.quality_weights });
  const [qw, setQw] = useState<Record<string, number>>(
    Object.fromEntries(QUERY.map((k) => [k, base.params.query[k] ?? 0])),
  );
  const rest = { ...base.params } as Record<string, unknown>;
  delete rest.quality_weights;
  const [json, setJson] = useState(JSON.stringify(rest, null, 2));
  const sum = WEIGHTS.reduce((s, k) => s + (Number(w[k]) || 0), 0);
  const qsum = QUERY.reduce((s, k) => s + (Number(qw[k]) || 0), 0);
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const ok = sum === 100 && Math.abs(qsum - 1) < 0.001 && parsed !== null;
  return (
    <Card
      title={`New draft (based on v${base.version})`}
      actions={
        <ActionDialog
          label="Save draft"
          title="Save a new draft version"
          reasons={reasons('ranking')}
          disabled={!ok}
          testId="save-draft"
          run={(reason) =>
            supabase().rpc('admin_create_ranking_draft', {
              p_params: {
                ...parsed,
                quality_weights: w,
                query: { ...(parsed?.query as object), ...qw },
              },
              p_reason: reason,
            })
          }
          onDone={done}
        />
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm font-medium">
            Quality score weights{' '}
            <span className={sum === 100 ? 'text-success-600' : 'text-danger-600'}>
              (sum {sum} / 100)
            </span>
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {WEIGHTS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <span className="w-28 text-ink-500">{k}</span>
                <input
                  className={field}
                  type="number"
                  min={0}
                  max={100}
                  value={w[k] ?? 0}
                  aria-label={`Weight ${k}`}
                  onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <p className="mt-4 text-sm font-medium">
            Query-time weights{' '}
            <span className={Math.abs(qsum - 1) < 0.001 ? 'text-success-600' : 'text-danger-600'}>
              (sum {qsum.toFixed(2)} / 1)
            </span>
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {QUERY.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <span className="w-28 text-ink-500">{k}</span>
                <input
                  className={field}
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={qw[k] ?? 0}
                  aria-label={`Query ${k}`}
                  onChange={(e) => setQw({ ...qw, [k]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="text-sm font-medium">Bayesian, trust, volume and label rules</p>
          <textarea
            className={`${field} mt-2 h-80 font-mono text-xs`}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            aria-label="Other parameters"
          />
          {parsed === null ? <p className="text-xs text-danger-600">Not valid JSON.</p> : null}
          <p className="text-xs text-ink-500">
            Validated on save (ranges, required keys). Labels with too-high thresholds simply
            produce no labels in a small market.
          </p>
        </div>
      </div>
    </Card>
  );
}

function Inspector() {
  const [q, setQ] = useState('');
  const [biz, setBiz] = useState<Biz | null>(null);
  const { data: hits } = useData<Biz[]>(
    () =>
      q.trim().length >= 2
        ? supabase().rpc('admin_list_businesses', { p_q: q.trim(), p_limit: 8 })
        : Promise.resolve({ data: [], error: null }),
    [q],
  );
  const { data: ex, error } = useData<Record<string, unknown>>(
    () =>
      biz
        ? supabase().rpc('admin_explain_rank', { p_business_id: biz.id })
        : Promise.resolve({ data: null, error: null }),
    [biz?.id],
  );
  return (
    <Card title="Why this rank">
      <input
        className={field}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setBiz(null);
        }}
        placeholder="Business name"
        aria-label="Inspect business"
      />
      {!biz && hits?.length ? (
        <ul className="mt-2 flex flex-col text-sm">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="text-accent-600" onClick={() => setBiz(h)}>
                {h.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <State error={error} />
      {biz && ex ? (
        <pre
          className="mt-2 overflow-x-auto rounded bg-surface-50 p-2 text-xs"
          data-testid="explain"
        >
          {JSON.stringify(ex, null, 2)}
        </pre>
      ) : null}
    </Card>
  );
}

interface DebugCard {
  name: string;
  area: string | null;
  display_rating: number | null;
  review_count: number;
  labels: string[];
  debug: {
    rank_score: number;
    quality_score: number;
    km: number | null;
    availability_fit: number;
    personal: number;
  };
}

/** Why results come out in this order for a query: the recommended score and its parts per card. */
function SearchDebugger() {
  const [q, setQ] = useState('');
  const [run, setRun] = useState('');
  const { data, error } = useData<{
    total: number;
    config_version: number;
    results: DebugCard[];
    intent_raw: Record<string, unknown>;
  }>(
    () =>
      run
        ? supabase().rpc('admin_search_debug', { p_q: run })
        : Promise.resolve({ data: null, error: null }),
    [run],
  );
  return (
    <Card title="Search debugger">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setRun(q.trim());
        }}
      >
        <input
          className={field}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Query, e.g. 7ala2 hamra"
          aria-label="Debug query"
          dir="auto"
        />
        <button type="submit" className="h-9 rounded-control border border-line-200 px-3 text-sm">
          Run
        </button>
      </form>
      <State error={error} />
      {data ? (
        <>
          <p className="mt-2 text-xs text-ink-500">
            {data.total} results · config v{data.config_version} · intent{' '}
            {JSON.stringify(data.intent_raw)}
          </p>
          <Table
            rows={data.results}
            testId="search-debug"
            cols={[
              ['#', (c) => data.results.indexOf(c) + 1],
              ['Business', (c) => <span dir="auto">{c.name}</span>],
              ['Area', (c) => c.area ?? '—'],
              ['Rank score', (c) => c.debug.rank_score],
              ['Quality', (c) => c.debug.quality_score],
              ['Distance', (c) => (c.debug.km == null ? '—' : `${c.debug.km} km`)],
              ['Availability', (c) => c.debug.availability_fit],
              [
                'Rating',
                (c) => (c.display_rating ? `${c.display_rating} (${c.review_count})` : 'new'),
              ],
              ['Labels', (c) => c.labels.join(', ')],
            ]}
          />
        </>
      ) : null}
    </Card>
  );
}
