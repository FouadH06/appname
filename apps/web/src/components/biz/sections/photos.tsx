'use client';

import { useState } from 'react';
import { useBiz } from '@/lib/biz/context';
import { loadMedia, publicMediaUrl, removeMedia, uploadMedia, type Media } from '@/lib/biz/data';
import { useLoad } from '@/lib/biz/use-load';
import { describeError } from '@/lib/copy';
import { supabase } from '@/lib/supabase';
import { Notice, Section, btn, codeOf } from '../ui';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic';

/** Cover (required to go live) and up to 10 portfolio photos, reorderable (Phase 2 B1 step 7). */
export function PhotosSection({ onSaved }: { onSaved?: () => void }) {
  const { business } = useBiz();
  const { data, reload } = useLoad(() => loadMedia(business.id), [business.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cover = data?.find((m) => m.kind === 'cover') ?? null;
  const portfolio = (data ?? []).filter((m) => m.kind === 'portfolio');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reload();
      onSaved?.();
    } catch (e) {
      const code = codeOf(e);
      setError(
        code === 'PORTFOLIO_FULL'
          ? 'Up to 10 portfolio photos. Remove one first.'
          : describeError(code),
      );
    } finally {
      setBusy(false);
    }
  };

  const move = (idx: number, dir: -1 | 1) => {
    const ids = portfolio.map((m) => m.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j]!, ids[idx]!];
    void run(async () => {
      const { error: err } = await supabase().rpc('reorder_business_media', {
        p_business_id: business.id,
        p_media_ids: ids,
      });
      if (err) throw err;
    });
  };

  return (
    <Section
      title="Photos"
      description="A cover photo is required to go live. Photos are published right away."
    >
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div>
        <p className="mb-2 text-sm font-medium">Cover</p>
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- public storage URL
          <img
            src={publicMediaUrl(cover.path)}
            alt="Cover"
            className="aspect-[16/9] w-full max-w-md rounded-card object-cover"
            data-testid="cover-photo"
          />
        ) : (
          <div className="grid aspect-[16/9] w-full max-w-md place-items-center rounded-card border border-dashed border-line-200 text-sm text-ink-500">
            No cover yet
          </div>
        )}
        <label className={btn.secondary + ' mt-2 cursor-pointer'}>
          {cover ? 'Replace cover' : 'Upload cover'}
          <input
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={busy}
            data-testid="cover-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void run(() => uploadMedia(business.id, f, 'cover'));
            }}
          />
        </label>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Portfolio ({portfolio.length}/10)</p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {portfolio.map((m: Media, idx) => (
            <li key={m.id} className="flex flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- public storage URL */}
              <img
                src={publicMediaUrl(m.path)}
                alt=""
                className="aspect-square w-full rounded-control object-cover"
              />
              <div className="flex justify-between text-xs">
                <button
                  type="button"
                  className={btn.link}
                  disabled={busy || idx === 0}
                  onClick={() => move(idx, -1)}
                  aria-label="Move earlier"
                >
                  ←
                </button>
                <button
                  type="button"
                  className={btn.link}
                  disabled={busy}
                  onClick={() => void run(() => removeMedia(m.id))}
                >
                  Remove
                </button>
                <button
                  type="button"
                  className={btn.link}
                  disabled={busy || idx === portfolio.length - 1}
                  onClick={() => move(idx, 1)}
                  aria-label="Move later"
                >
                  →
                </button>
              </div>
            </li>
          ))}
        </ul>
        {portfolio.length < 10 ? (
          <label className={btn.secondary + ' mt-2 cursor-pointer'}>
            Add photos
            <input
              type="file"
              accept={ACCEPT}
              multiple
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []).slice(0, 10 - portfolio.length);
                e.target.value = '';
                if (files.length)
                  void run(async () => {
                    for (const f of files) await uploadMedia(business.id, f, 'portfolio');
                  });
              }}
            />
          </label>
        ) : null}
      </div>
      {busy ? <p className="text-sm text-ink-500">Uploading…</p> : null}
    </Section>
  );
}
