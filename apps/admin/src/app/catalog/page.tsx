'use client';

import { useState } from 'react';
import type { Database } from '@app/db';
import { ActionDialog, Badge, Card, Shell, State, Table, field, useData } from '@/components/ui';
import { CATALOG_ROLES, useAdminGate } from '@/lib/gate';
import { reasons } from '@/lib/reasons';
import { supabase } from '@/lib/supabase';

// A8 Catalog: categories + rating dimensions, canonical services + synonyms + relevance hints, areas +
// aliases + clusters, suggestions inbox ("Other" services from businesses). Every edit needs a reason.

type Lang = Database['public']['Enums']['synonym_lang'];
interface Dimension {
  id: string;
  key: string;
  label_en: string;
  label_ar: string;
  sort: number;
  is_active: boolean;
}
interface Category {
  id: string;
  parent_id: string | null;
  slug: string;
  name_en: string;
  name_ar: string;
  is_live: boolean;
  allows_before_after_default: boolean;
  requires_consultation_default: boolean;
  sort: number;
  dimensions: Dimension[];
}
interface Service {
  id: string;
  category_id: string;
  slug: string;
  name_en: string;
  name_ar: string;
  typical_duration_min: number | null;
  allows_before_after: boolean;
  relevance_hints: string[];
  is_active: boolean;
  usage: number;
  synonyms: { id: string; term: string; lang: Lang; ambiguous: boolean }[];
}
interface Area {
  id: string;
  parent_id: string | null;
  level: string;
  slug: string;
  name_en: string;
  name_ar: string;
  is_live: boolean;
  aliases: string[];
  clusters: string[];
}
interface Cluster {
  id: string;
  slug: string;
  name_en: string;
  target_businesses: number;
  is_live: boolean;
}
interface Catalog {
  categories: Category[];
  services: Service[];
  areas: Area[];
  clusters: Cluster[];
  suggestions: { id: string; proposed_name: string; business: string; created_at: string }[];
}

const TABS = ['Services', 'Categories', 'Areas', 'Suggestions'] as const;
const list = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export default function CatalogPage() {
  const access = useAdminGate(CATALOG_ROLES);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Services');
  const { data, error, loading, reload } = useData<Catalog>(
    () => supabase().rpc('admin_get_catalog'),
    [],
  );
  if (!access) return null;
  const done = () => void reload();
  return (
    <Shell access={access} title="Catalog">
      <div className="flex gap-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`rounded-full border px-3 py-1 text-sm ${tab === t ? 'border-accent-600 bg-accent-600 text-white' : 'border-line-200'}`}
            onClick={() => setTab(t)}
          >
            {t}
            {t === 'Suggestions' && data?.suggestions.length ? ` (${data.suggestions.length})` : ''}
          </button>
        ))}
      </div>
      <State loading={loading && !data} error={error} />
      {data && tab === 'Services' ? <Services data={data} done={done} /> : null}
      {data && tab === 'Categories' ? <Categories data={data} done={done} /> : null}
      {data && tab === 'Areas' ? <Areas data={data} done={done} /> : null}
      {data && tab === 'Suggestions' ? <Suggestions data={data} done={done} /> : null}
    </Shell>
  );
}

function Services({ data, done }: { data: Catalog; done: () => void }) {
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const cats = new Map(data.categories.map((c) => [c.id, c.name_en]));
  const rows = data.services.filter(
    (s) =>
      (!cat || s.category_id === cat) &&
      (!q ||
        `${s.name_en} ${s.name_ar} ${s.synonyms.map((y) => y.term).join(' ')}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
  return (
    <>
      <div className="flex gap-2">
        <input
          className={field}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Service or synonym"
          aria-label="Search services"
        />
        <select
          className={field + ' max-w-56'}
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          aria-label="Category"
        >
          <option value="">All categories</option>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_en}
            </option>
          ))}
        </select>
        <ServiceEditor categories={data.categories} done={done} />
      </div>
      <Table
        rows={rows}
        testId="services"
        cols={[
          [
            'Service',
            (s) => (
              <span className={s.is_active ? '' : 'text-ink-500 line-through'}>
                {s.name_en}{' '}
                <span className="text-ink-500" dir="rtl">
                  {s.name_ar}
                </span>
              </span>
            ),
          ],
          ['Category', (s) => cats.get(s.category_id) ?? '—'],
          ['Used by', (s) => s.usage],
          [
            'Synonyms',
            (s) => (
              <span className="flex flex-wrap gap-1">
                {s.synonyms.map((y) => (
                  <SynonymChip key={y.id} y={y} done={done} />
                ))}
                <AddSynonym serviceId={s.id} done={done} />
              </span>
            ),
          ],
          [
            'Relevance hints',
            (s) => (
              <span className="text-xs text-ink-700">{s.relevance_hints.join(', ') || '—'}</span>
            ),
          ],
          ['', (s) => <ServiceEditor service={s} categories={data.categories} done={done} />],
        ]}
      />
    </>
  );
}

function SynonymChip({ y, done }: { y: Service['synonyms'][number]; done: () => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={y.ambiguous ? 'warn' : 'neutral'}>
        <span dir="auto">{y.term}</span> <span className="text-ink-500">{y.lang}</span>
      </Badge>
      <ActionDialog
        label="×"
        title={`Remove synonym “${y.term}”`}
        reasons={reasons('catalog')}
        danger
        run={(reason) =>
          supabase().rpc('admin_remove_synonym', { p_synonym_id: y.id, p_reason: reason })
        }
        onDone={done}
      />
    </span>
  );
}

function AddSynonym({ serviceId, done }: { serviceId: string; done: () => void }) {
  const [term, setTerm] = useState('');
  const [lang, setLang] = useState<Lang>('en');
  return (
    <ActionDialog
      label="+ synonym"
      title="Add a synonym"
      reasons={reasons('catalog')}
      testId="add-synonym"
      run={(reason) =>
        supabase().rpc('admin_add_synonym', {
          p_canonical_service_id: serviceId,
          p_term: term,
          p_lang: lang,
          p_reason: reason,
        })
      }
      onDone={() => {
        setTerm('');
        done();
      }}
    >
      <input
        className={field}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="e.g. 7ala2, حلاق, coiffeur homme"
        aria-label="Term"
        dir="auto"
      />
      <select
        className={field}
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        aria-label="Language"
      >
        {(['en', 'ar', 'fr', 'arabizi'] as Lang[]).map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <p className="text-xs text-ink-500">
        A term used by another service is allowed but flagged as ambiguous.
      </p>
    </ActionDialog>
  );
}

function ServiceEditor({
  service,
  categories,
  done,
}: {
  service?: Service;
  categories: Category[];
  done: () => void;
}) {
  const [v, setV] = useState({
    category_id: service?.category_id ?? categories[0]?.id ?? '',
    slug: service?.slug ?? '',
    name_en: service?.name_en ?? '',
    name_ar: service?.name_ar ?? '',
    typical_duration_min: service?.typical_duration_min?.toString() ?? '',
    relevance_hints: service?.relevance_hints.join(', ') ?? '',
    allows_before_after: service?.allows_before_after ?? false,
    is_active: service?.is_active ?? true,
  });
  const set = (k: keyof typeof v, x: string | boolean) => setV((o) => ({ ...o, [k]: x }));
  return (
    <ActionDialog
      label={service ? 'Edit' : '+ Canonical service'}
      title={service ? `Edit ${service.name_en}` : 'New canonical service'}
      reasons={reasons('catalog')}
      testId={service ? undefined : 'new-service'}
      run={(reason) =>
        supabase().rpc('admin_save_canonical_service', {
          p: {
            ...(service ? { id: service.id } : {}),
            category_id: v.category_id,
            slug: v.slug,
            name_en: v.name_en,
            name_ar: v.name_ar,
            typical_duration_min: v.typical_duration_min ? Number(v.typical_duration_min) : null,
            relevance_hints: list(v.relevance_hints),
            allows_before_after: v.allows_before_after,
            is_active: v.is_active,
          },
          p_reason: reason,
        })
      }
      onDone={done}
    >
      <select
        className={field}
        value={v.category_id}
        onChange={(e) => set('category_id', e.target.value)}
        aria-label="Category"
      >
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name_en}
          </option>
        ))}
      </select>
      <input
        className={field}
        value={v.slug}
        onChange={(e) => set('slug', e.target.value)}
        placeholder="slug (e.g. mens-haircut)"
        aria-label="Slug"
      />
      <input
        className={field}
        value={v.name_en}
        onChange={(e) => set('name_en', e.target.value)}
        placeholder="Name (English)"
        aria-label="Name (English)"
      />
      <input
        className={field}
        value={v.name_ar}
        onChange={(e) => set('name_ar', e.target.value)}
        placeholder="الاسم (عربي)"
        aria-label="Name (Arabic)"
        dir="rtl"
      />
      <input
        className={field}
        value={v.typical_duration_min}
        onChange={(e) => set('typical_duration_min', e.target.value)}
        placeholder="Typical duration (min)"
        aria-label="Typical duration"
        inputMode="numeric"
      />
      <input
        className={field}
        value={v.relevance_hints}
        onChange={(e) => set('relevance_hints', e.target.value)}
        placeholder="Relevance hints for photo checks (comma-separated)"
        aria-label="Relevance hints"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.allows_before_after}
          onChange={(e) => set('allows_before_after', e.target.checked)}
        />{' '}
        Before/after photos allowed
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.is_active}
          onChange={(e) => set('is_active', e.target.checked)}
        />{' '}
        Active (a service in use can't be switched off)
      </label>
    </ActionDialog>
  );
}

function Categories({ data, done }: { data: Catalog; done: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      {data.categories.map((c) => (
        <Card
          key={c.id}
          title={
            <span className="flex items-center gap-2">
              {c.parent_id ? '↳ ' : ''}
              {c.name_en}{' '}
              <span className="text-ink-500" dir="rtl">
                {c.name_ar}
              </span>
              <Badge tone={c.is_live ? 'good' : 'neutral'}>{c.is_live ? 'live' : 'hidden'}</Badge>
            </span>
          }
          actions={<CategoryEditor c={c} done={done} />}
        >
          <p className="text-xs text-ink-500">
            before/after default {c.allows_before_after_default ? 'on' : 'off'} · consultation
            default {c.requires_consultation_default ? 'on' : 'off'}
          </p>
          {c.parent_id === null ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-ink-500">Rating dimensions:</span>
              {c.dimensions.map((d) => (
                <span key={d.id} className="inline-flex items-center gap-1">
                  <Badge tone={d.is_active ? 'neutral' : 'bad'}>
                    {d.sort}. {d.label_en}
                  </Badge>
                  <ActionDialog
                    label={d.is_active ? 'hide' : 'show'}
                    title={`${d.is_active ? 'Hide' : 'Show'} “${d.label_en}” (existing ratings are kept)`}
                    reasons={reasons('catalog')}
                    run={(reason) =>
                      supabase().rpc('admin_save_rating_dimension', {
                        p: { id: d.id, is_active: !d.is_active },
                        p_reason: reason,
                      })
                    }
                    onDone={done}
                  />
                </span>
              ))}
              <DimensionEditor categoryId={c.id} next={c.dimensions.length + 1} done={done} />
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function CategoryEditor({ c, done }: { c: Category; done: () => void }) {
  const [v, setV] = useState({
    name_en: c.name_en,
    name_ar: c.name_ar,
    is_live: c.is_live,
    ba: c.allows_before_after_default,
    consult: c.requires_consultation_default,
  });
  return (
    <ActionDialog
      label="Edit"
      title={`Edit ${c.name_en}`}
      reasons={reasons('catalog')}
      run={(reason) =>
        supabase().rpc('admin_save_category', {
          p: {
            id: c.id,
            name_en: v.name_en,
            name_ar: v.name_ar,
            is_live: v.is_live,
            allows_before_after_default: v.ba,
            requires_consultation_default: v.consult,
          },
          p_reason: reason,
        })
      }
      onDone={done}
    >
      <input
        className={field}
        value={v.name_en}
        onChange={(e) => setV({ ...v, name_en: e.target.value })}
        aria-label="Name (English)"
      />
      <input
        className={field}
        value={v.name_ar}
        onChange={(e) => setV({ ...v, name_ar: e.target.value })}
        aria-label="Name (Arabic)"
        dir="rtl"
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.is_live}
          onChange={(e) => setV({ ...v, is_live: e.target.checked })}
        />{' '}
        Live (visible to customers)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.ba}
          onChange={(e) => setV({ ...v, ba: e.target.checked })}
        />{' '}
        Before/after allowed by default
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={v.consult}
          onChange={(e) => setV({ ...v, consult: e.target.checked })}
        />{' '}
        Requires consultation by default
      </label>
    </ActionDialog>
  );
}

function DimensionEditor({
  categoryId,
  next,
  done,
}: {
  categoryId: string;
  next: number;
  done: () => void;
}) {
  const [v, setV] = useState({ key: '', label_en: '', label_ar: '' });
  return (
    <ActionDialog
      label="+ dimension"
      title="New rating dimension"
      reasons={reasons('catalog')}
      run={(reason) =>
        supabase().rpc('admin_save_rating_dimension', {
          p: { category_id: categoryId, sort: next, ...v },
          p_reason: reason,
        })
      }
      onDone={done}
    >
      <input
        className={field}
        value={v.key}
        onChange={(e) => setV({ ...v, key: e.target.value })}
        placeholder="key (e.g. cleanliness)"
        aria-label="Key"
      />
      <input
        className={field}
        value={v.label_en}
        onChange={(e) => setV({ ...v, label_en: e.target.value })}
        placeholder="Label (English)"
        aria-label="Label (English)"
      />
      <input
        className={field}
        value={v.label_ar}
        onChange={(e) => setV({ ...v, label_ar: e.target.value })}
        placeholder="التسمية"
        aria-label="Label (Arabic)"
        dir="rtl"
      />
    </ActionDialog>
  );
}

function Areas({ data, done }: { data: Catalog; done: () => void }) {
  const [q, setQ] = useState('');
  const clusters = new Map(data.clusters.map((c) => [c.id, c.name_en]));
  const rows = data.areas.filter(
    (a) =>
      a.level === 'area' &&
      (!q || `${a.name_en} ${a.aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <>
      <Card title="Launch clusters">
        <Table
          rows={data.clusters}
          cols={[
            ['Cluster', (c) => c.name_en],
            ['Target businesses', (c) => c.target_businesses],
            [
              'Status',
              (c) => (
                <Badge tone={c.is_live ? 'good' : 'neutral'}>
                  {c.is_live ? 'live' : 'not live'}
                </Badge>
              ),
            ],
            ['', (c) => <ClusterEditor c={c} done={done} />],
          ]}
        />
      </Card>
      <input
        className={field}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Area or alias"
        aria-label="Search areas"
      />
      <Table
        rows={rows}
        testId="areas"
        cols={[
          [
            'Area',
            (a) => (
              <span>
                {a.name_en}{' '}
                <span className="text-ink-500" dir="rtl">
                  {a.name_ar}
                </span>
              </span>
            ),
          ],
          [
            'Aliases',
            (a) => (
              <span className="text-xs" dir="auto">
                {a.aliases.join(' · ') || '—'}
              </span>
            ),
          ],
          ['Clusters', (a) => a.clusters.map((c) => clusters.get(c)).join(', ') || '—'],
          [
            'Status',
            (a) => (
              <Badge tone={a.is_live ? 'good' : 'neutral'}>{a.is_live ? 'live' : 'not live'}</Badge>
            ),
          ],
          ['', (a) => <AreaEditor a={a} clusters={data.clusters} done={done} />],
        ]}
      />
    </>
  );
}

function AreaEditor({ a, clusters, done }: { a: Area; clusters: Cluster[]; done: () => void }) {
  const [live, setLive] = useState(a.is_live);
  const [aliases, setAliases] = useState(a.aliases.join(', '));
  const [cl, setCl] = useState<string[]>(a.clusters);
  return (
    <ActionDialog
      label="Edit"
      title={`Edit ${a.name_en}`}
      reasons={reasons('catalog')}
      run={(reason) =>
        supabase().rpc('admin_save_area', {
          p_area_id: a.id,
          p: { is_live: live, aliases: list(aliases), cluster_ids: cl },
          p_reason: reason,
        })
      }
      onDone={done}
    >
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live
      </label>
      <input
        className={field}
        value={aliases}
        onChange={(e) => setAliases(e.target.value)}
        placeholder="Aliases, comma-separated (Achrafieh, Ashrafieh, الأشرفية)"
        aria-label="Aliases"
        dir="auto"
      />
      <div className="flex flex-col gap-1 text-sm">
        {clusters.map((c) => (
          <label key={c.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={cl.includes(c.id)}
              onChange={(e) =>
                setCl(e.target.checked ? [...cl, c.id] : cl.filter((x) => x !== c.id))
              }
            />
            {c.name_en}
          </label>
        ))}
      </div>
    </ActionDialog>
  );
}

function ClusterEditor({ c, done }: { c: Cluster; done: () => void }) {
  const [target, setTarget] = useState(String(c.target_businesses));
  const [live, setLive] = useState(c.is_live);
  return (
    <ActionDialog
      label="Edit"
      title={`Edit ${c.name_en}`}
      reasons={reasons('catalog')}
      run={(reason) =>
        supabase().rpc('admin_save_cluster', {
          p_cluster_id: c.id,
          p: { target_businesses: Number(target), is_live: live },
          p_reason: reason,
        })
      }
      onDone={done}
    >
      <input
        className={field}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        aria-label="Target businesses"
        inputMode="numeric"
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live
      </label>
    </ActionDialog>
  );
}

function Suggestions({ data, done }: { data: Catalog; done: () => void }) {
  if (data.suggestions.length === 0) return <State empty emptyText="No open suggestions." />;
  return (
    <Table
      rows={data.suggestions}
      testId="suggestions"
      cols={[
        ['Proposed service', (g) => <span dir="auto">{g.proposed_name}</span>],
        ['Business', (g) => g.business],
        [
          '',
          (g) => (
            <SuggestionActions
              id={g.id}
              name={g.proposed_name}
              services={data.services}
              categories={data.categories}
              done={done}
            />
          ),
        ],
      ]}
    />
  );
}

function SuggestionActions({
  id,
  name,
  services,
  categories,
  done,
}: {
  id: string;
  name: string;
  services: Service[];
  categories: Category[];
  done: () => void;
}) {
  const [target, setTarget] = useState('');
  const [cat, setCat] = useState(categories[0]?.id ?? '');
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return (
    <span className="flex gap-2">
      <ActionDialog
        label="Map"
        title={`Map “${name}” to an existing service`}
        reasons={reasons('catalog')}
        run={(reason) =>
          supabase().rpc('admin_resolve_suggestion', {
            p_suggestion_id: id,
            p_action: 'map',
            p_canonical_service_id: target,
            p_reason: reason,
          })
        }
        onDone={done}
      >
        <select
          className={field}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Canonical service"
        >
          <option value="">Choose a service…</option>
          {services
            .filter((s) => s.is_active)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name_en}
              </option>
            ))}
        </select>
      </ActionDialog>
      <ActionDialog
        label="Create"
        title={`Create “${name}” as a canonical service`}
        reasons={reasons('catalog')}
        run={(reason) =>
          supabase().rpc('admin_resolve_suggestion', {
            p_suggestion_id: id,
            p_action: 'create',
            p_new: { category_id: cat, slug, name_en: name, name_ar: name },
            p_reason: reason,
          })
        }
        onDone={done}
      >
        <select
          className={field}
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          aria-label="Category"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name_en}
            </option>
          ))}
        </select>
        <p className="text-xs text-ink-500">
          Created with the proposed name ({slug}); add the Arabic name and synonyms afterwards.
        </p>
      </ActionDialog>
      <ActionDialog
        label="Reject"
        title={`Reject “${name}”`}
        reasons={reasons('catalog')}
        danger
        run={(reason) =>
          supabase().rpc('admin_resolve_suggestion', {
            p_suggestion_id: id,
            p_action: 'reject',
            p_reason: reason,
          })
        }
        onDone={done}
      />
    </span>
  );
}
