'use client';

import { Badge, Card, Shell, State, Table, fmt, useData } from '@/components/ui';
import { OPS_ROLES, useAdminGate } from '@/lib/gate';
import { supabase } from '@/lib/supabase';

// M14 Launch readiness (ops): Gate D cluster targets, each live business's missing items (go-live
// checklist + launch checks), and platform settings visible from the database.

interface Readiness {
  clusters: {
    id: string;
    name: string;
    target: number;
    live: number;
    ready: number;
    categories: Record<string, number>;
    gate_d_min_15: boolean;
  }[];
  businesses: {
    id: string;
    name: string;
    slug: string;
    status: string;
    category: string | null;
    ready: boolean;
    missing: string[];
    bookings_14d: number;
    failed_messages_7d: number;
  }[];
  platform: {
    web_base_url: string | null;
    web_base_url_is_local: boolean;
    whatsapp_templates_approved: number;
    whatsapp_templates_active: number;
    ranking_active: boolean;
    quality_scores_at: string | null;
    test_businesses: number;
  };
}

const MISSING: Record<string, string> = {
  location: 'location',
  hours: 'opening hours',
  service: 'bookable priced service',
  staff_hours: 'staff hours',
  cover: 'approved cover photo',
  contact: 'phone / WhatsApp',
  map_pin: 'map pin',
  public_staff: 'publicly bookable staff',
  description: 'description (40+ chars)',
  owner_account: 'owner account',
  paused: 'online booking paused',
};

export default function LaunchPage() {
  const access = useAdminGate(OPS_ROLES);
  const { data, error, loading } = useData<Readiness>(
    () => supabase().rpc('admin_launch_readiness'),
    [],
  );
  if (!access) return null;
  const p = data?.platform;
  return (
    <Shell access={access} title="Launch readiness">
      <div className="flex flex-col gap-4" data-testid="launch-readiness">
        <State loading={loading} error={error} />
        {data && p ? (
          <>
            <Card title="Clusters (Gate D: 50–70 live, ≥ 15 per cluster)">
              <Table
                rows={data.clusters}
                testId="clusters"
                cols={[
                  ['Cluster', (c) => c.name],
                  ['Live / target', (c) => `${c.live} / ${c.target}`],
                  ['Ready', (c) => c.ready],
                  [
                    '≥ 15 live',
                    (c) =>
                      c.gate_d_min_15 ? (
                        <Badge tone="good">yes</Badge>
                      ) : (
                        <Badge tone="warn">no</Badge>
                      ),
                  ],
                  [
                    'By category',
                    (c) =>
                      Object.entries(c.categories)
                        .map(([k, n]) => `${k} ${n}`)
                        .join(' · ') || '—',
                  ],
                ]}
              />
            </Card>
            <Card title="Platform">
              <ul className="flex flex-col gap-1 text-sm" data-testid="platform">
                <li>
                  Web address for links:{' '}
                  <span className={p.web_base_url_is_local ? 'text-danger-600' : ''}>
                    {p.web_base_url ?? 'not set'}
                    {p.web_base_url_is_local ? ' (local — set the real domain)' : ''}
                  </span>
                </li>
                <li>
                  WhatsApp templates approved: {p.whatsapp_templates_approved} /{' '}
                  {p.whatsapp_templates_active}
                </li>
                <li>Ranking config active: {p.ranking_active ? 'yes' : 'no'}</li>
                <li>Quality scores computed: {fmt(p.quality_scores_at)}</li>
                <li>Test businesses (hidden from customers): {p.test_businesses}</li>
              </ul>
            </Card>
            <Card title="Live businesses">
              <Table
                rows={data.businesses}
                testId="readiness"
                href={(b) => `/businesses/${b.id}`}
                cols={[
                  ['Business', (b) => b.name],
                  ['Category', (b) => b.category ?? '—'],
                  [
                    'Ready',
                    (b) =>
                      b.ready ? <Badge tone="good">ready</Badge> : <Badge tone="warn">no</Badge>,
                  ],
                  ['Missing', (b) => b.missing.map((m) => MISSING[m] ?? m).join(', ') || '—'],
                  ['Bookings 14 d', (b) => b.bookings_14d],
                  [
                    'Failed messages 7 d',
                    (b) =>
                      b.failed_messages_7d ? <Badge tone="bad">{b.failed_messages_7d}</Badge> : 0,
                  ],
                ]}
              />
            </Card>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
