'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { primaryButton, secondaryButton } from '@/components/card';
import { describeError } from '@/lib/copy';
import { photoReasonText, ugcUrl } from '@/lib/public/format';
import { supabase } from '@/lib/supabase';

// C16 Upload Customer Result (Phase 2 C16; Part 4 §2.3). Consent first; up to 4 photos; each photo
// is decoded, oriented, resized to ≤ 2048 px and re-encoded on the device (which drops all metadata —
// the server strips again), uploaded to the private bucket at the registered path, then checked.

export const CONSENT_VERSION = 'c16-v1';
const MAX = 4;
const MIN_SIDE = 300;

interface MyMedia {
  id: string;
  media_id: string;
  state: 'pending' | 'approved' | 'approved_redacted' | 'manual_review' | 'rejected' | 'removed';
  status: string;
  reason: string | null;
  thumb: string | null;
}

type Local = {
  key: string;
  name: string;
  blob?: Blob;
  preview?: string;
  path?: string;
  mediaId?: string;
  phase: 'preparing' | 'uploading' | 'checking' | 'error';
  error?: string;
};

/** Decode (EXIF orientation applied), downscale and re-encode as JPEG — metadata never leaves the phone. */
export async function preparePhoto(
  file: File,
): Promise<{ blob: Blob; width: number; height: number }> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name)
        ? 'HEIC_UNSUPPORTED'
        : 'UNREADABLE',
    );
  }
  if (Math.min(bmp.width, bmp.height) < MIN_SIDE) throw new Error('TOO_SMALL');
  const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
  const width = Math.round(bmp.width * scale);
  const height = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('UNREADABLE'))), 'image/jpeg', 0.9),
  );
  return { blob, width, height };
}

const LOCAL_ERRORS: Record<string, string> = {
  HEIC_UNSUPPORTED:
    'This browser can’t open HEIC photos. Choose it again from your Photos app (it’s converted automatically) or pick a JPEG.',
  UNREADABLE: 'This file isn’t a photo we can open.',
  TOO_SMALL: 'This photo is too small (at least 300 px).',
};

export function ResultUploader({ reviewId, service }: { reviewId: string; service: string }) {
  const [agree, setAgree] = useState(false);
  const [consented, setConsented] = useState(false);
  const [media, setMedia] = useState<MyMedia[] | null>(null);
  const [local, setLocal] = useState<Local[]>([]);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const polls = useRef(0);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase().rpc('get_my_review_media', {
      p_review_id: reviewId,
    });
    if (e) return setError(describeError(e.message));
    setMedia((data as unknown as MyMedia[]) ?? []);
  }, [reviewId]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  // while something is being checked, refresh now and then (usually a few minutes)
  const checking =
    (media ?? []).some((m) => m.state === 'pending') || local.some((l) => l.phase === 'checking');
  useEffect(() => {
    if (!checking || polls.current > 60) return;
    const t = window.setTimeout(() => {
      polls.current += 1;
      void load().then(() => setLocal((xs) => xs.filter((l) => l.phase !== 'checking')));
    }, 4000);
    return () => window.clearTimeout(t);
  }, [checking, media, load]);

  const used =
    (media ?? []).filter((m) => m.state !== 'rejected').length +
    local.filter((l) => l.phase !== 'error').length;
  const room = Math.max(0, MAX - used);

  const patch = (key: string, p: Partial<Local>) =>
    setLocal((xs) => xs.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const upload = async (item: Local) => {
    if (!item.blob || !item.path || !item.mediaId) return;
    patch(item.key, { phase: 'uploading', error: undefined });
    const { error: upErr } = await supabase()
      .storage.from('ugc-private')
      .upload(item.path, item.blob, { contentType: 'image/jpeg', upsert: false });
    if (upErr && !/exists|duplicate/i.test(upErr.message)) {
      return patch(item.key, {
        phase: 'error',
        error: 'Upload failed. Check your connection and retry.',
      });
    }
    const { error: finErr } = await supabase().rpc('finalize_media_upload', {
      p_media_id: item.mediaId,
    });
    if (finErr) return patch(item.key, { phase: 'error', error: describeError(finErr.message) });
    patch(item.key, { phase: 'checking' });
  };

  const choose = async (files: FileList | null) => {
    setError(null);
    const picked = Array.from(files ?? []).slice(0, room);
    if (!picked.length) return;
    const items: Local[] = picked.map((f, i) => ({
      key: `${Date.now()}-${i}`,
      name: f.name,
      phase: 'preparing',
    }));
    setLocal((xs) => [...xs, ...items]);
    // prepare on the device first; only photos we can open are registered
    const ready: { item: Local; blob: Blob }[] = [];
    for (const [i, f] of picked.entries()) {
      const item = items[i]!;
      try {
        const { blob } = await preparePhoto(f);
        ready.push({ item, blob });
        patch(item.key, { blob, preview: URL.createObjectURL(blob) });
      } catch (e) {
        patch(item.key, {
          phase: 'error',
          error: LOCAL_ERRORS[(e as Error).message] ?? LOCAL_ERRORS.UNREADABLE,
        });
      }
    }
    if (!ready.length) return;
    const { data, error: e } = await supabase().rpc('request_review_media_upload', {
      p_review_id: reviewId,
      p_items: ready.map(() => ({ kind: 'result' })),
      p_consent_version: CONSENT_VERSION,
    });
    if (e) {
      for (const r of ready) patch(r.item.key, { phase: 'error', error: describeError(e.message) });
      return;
    }
    const slots = data as unknown as { media_id: string; upload_path: string }[];
    await Promise.all(
      ready.map(async ({ item, blob }, i) => {
        const slot = slots[i]!;
        const next = { ...item, blob, path: slot.upload_path, mediaId: slot.media_id };
        patch(item.key, { path: slot.upload_path, mediaId: slot.media_id });
        await upload(next);
      }),
    );
  };

  const remove = async (m: MyMedia) => {
    if (!window.confirm('Remove this photo? It disappears from the business page at once.')) return;
    const { error: e } = await supabase().rpc('delete_my_media', { p_review_media_id: m.id });
    if (e) return setError(describeError(e.message));
    void load();
  };

  if (media === null) return null;
  const shown = media.filter((m) => m.state !== 'removed');

  return (
    <section
      className="flex flex-col gap-3 border-t border-line-200 pt-4"
      data-testid="result-uploader"
    >
      <h2 className="font-medium text-ink-900">Share your result</h2>
      {shown.length || local.length ? (
        <ul className="grid grid-cols-2 gap-2">
          {shown.map((m) => (
            <li
              key={m.id}
              className="flex flex-col gap-1 text-xs"
              data-testid="my-photo"
              data-state={m.state}
            >
              <div className="aspect-square overflow-hidden rounded-control bg-surface-100">
                {m.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element -- public derivative
                  <img src={ugcUrl(m.thumb) ?? ''} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <span className={m.state === 'rejected' ? 'text-danger-600' : 'text-ink-700'}>
                {m.state === 'approved'
                  ? 'Live on the business page'
                  : m.state === 'rejected'
                    ? `Not published. ${photoReasonText(m.reason, service)}`
                    : 'In review — usually a few minutes'}
              </span>
              {m.state !== 'rejected' ? (
                <button
                  type="button"
                  className="self-start text-danger-600"
                  onClick={() => void remove(m)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
          {local
            .filter((l) => l.phase !== 'checking')
            .map((l) => (
              <li
                key={l.key}
                className="flex flex-col gap-1 text-xs"
                data-testid="upload-item"
                data-phase={l.phase}
              >
                <div className="aspect-square overflow-hidden rounded-control bg-surface-100">
                  {l.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local preview (object URL)
                    <img src={l.preview} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <span className={l.phase === 'error' ? 'text-danger-600' : 'text-ink-700'}>
                  {l.phase === 'error'
                    ? l.error
                    : l.phase === 'preparing'
                      ? 'Preparing…'
                      : 'Uploading…'}
                </span>
                {l.phase === 'error' && l.mediaId ? (
                  <button
                    type="button"
                    className="self-start text-accent-600"
                    onClick={() => void upload(l)}
                  >
                    Retry
                  </button>
                ) : null}
              </li>
            ))}
        </ul>
      ) : null}

      {room > 0 ? (
        consented ? (
          <>
            <input
              ref={input}
              type="file"
              // JPEG/PNG/WebP only: iPhones convert HEIC to JPEG when the picker doesn't accept HEIC
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              aria-label="Choose photos"
              data-testid="photo-input"
              onChange={(e) => {
                void choose(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className={secondaryButton}
              onClick={() => input.current?.click()}
            >
              {shown.length || local.length
                ? `Add more photos (${room} left)`
                : 'Choose photos (up to 4)'}
            </button>
          </>
        ) : (
          <div
            className="flex flex-col gap-2 rounded-control bg-surface-50 p-3 text-sm"
            data-testid="photo-consent"
          >
            <p className="text-ink-900">
              Your photos may appear publicly on the business’s page and on APP_NAME, with your
              first name. Photos are checked before they appear.
            </p>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>I have permission to share this image</span>
            </label>
            <button
              type="button"
              className={primaryButton}
              disabled={!agree}
              onClick={() => setConsented(true)}
            >
              Continue
            </button>
          </div>
        )
      ) : null}
      {error ? (
        <p className="text-sm text-danger-600" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
