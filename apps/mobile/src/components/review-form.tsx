import * as ImagePicker from 'expo-image-picker';
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator';
import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, Switch, Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Body, Button, C, Card, Field, H2, Muted, Row, State, confirmAction as confirm } from '@/components/ui';
import { describeError, ugcUrl } from '@/lib/format';
import { supabase } from '@/lib/supabase';

// C15 Write a review + C16 Share your result — the web ReviewForm/ResultUploader contracts
// (get_review_context · submit_review · edit_my_review · delete_my_review · request_review_media_upload ·
// finalize_media_upload). Stars publish right away; the comment appears after the automatic check.

interface ReviewContext {
  booking_id: string;
  eligible: boolean;
  reason: string | null;
  trust_tier: 'verified_booking' | 'verified_visit' | null;
  visit_at: string;
  business: { name: string; slug: string };
  service: string | null;
  staff_first_name: string | null;
  dimensions: { key: string; label_en: string; label_ar: string }[];
  review: { id: string; overall: number; text: string | null; status: string; rating_state: string; text_state: string | null; can_edit: boolean; ratings: Record<string, number> } | null;
}

const MIN = 20;
const MAX = 2000;
const STAR_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];
const TIER = { verified_booking: 'Verified booking', verified_visit: 'Verified visit' } as const;
export const CONSENT_VERSION = 'c16-v1';
const PHOTO_REASONS: Record<string, string> = {
  not_relevant: "It doesn't seem to show your {service}.",
  not_your_result: "It looks like a photo that isn't from your visit.",
  duplicate: 'You already shared this photo.',
  contact_info: 'It shows contact details or a QR code.',
  unsupported_file: "The file couldn't be opened.",
  too_small: 'The image is too small (at least 300 px).',
  upload_incomplete: "The upload didn't finish. Try again.",
};
const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

/** A random id kept on this device (fraud pre-check: several accounts reviewing from one phone). */
async function deviceId(): Promise<string | undefined> {
  try {
    if (Platform.OS === 'web') {
      let v = localStorage.getItem('app.device');
      if (!v) localStorage.setItem('app.device', (v = uuid()));
      return v;
    }
    let v = await SecureStore.getItemAsync('app.device');
    if (!v) await SecureStore.setItemAsync('app.device', (v = uuid()));
    return v;
  } catch {
    return undefined;
  }
}

function StarInput({ value, onChange, label, size = 36 }: { value: number; onChange: (v: number) => void; label: string; size?: number }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable key={n} accessibilityRole="radio" accessibilityState={{ checked: value === n }} accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
          onPress={() => onChange(n)} hitSlop={4} testID={`${label === 'Overall rating' ? 'star' : 'dim-star'}-${n}`}>
          <Text style={{ fontSize: size, color: n <= value ? '#D08A00' : C.line }}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ReviewForm({ bookingId }: { bookingId: string }) {
  const [ctx, setCtx] = useState<ReviewContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [overall, setOverall] = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text_state: string | null } | null>(null);
  const idempotencyKey = useMemo(uuid, []);

  const load = useCallback(
    () =>
      supabase()
        .rpc('get_review_context', { p_booking_id: bookingId })
        .then(({ data, error: e }) => (e ? setError(describeError(e.message)) : setCtx(data as unknown as ReviewContext))),
    [bookingId],
  );
  useEffect(() => void load(), [load]);

  const trimmed = text.trim();
  const textOk = trimmed.length === 0 || (trimmed.length >= MIN && trimmed.length <= MAX);
  const submit = async () => {
    if (!ctx || overall < 1 || !textOk) return;
    setBusy(true);
    setError(null);
    const { data, error: e } =
      editing && ctx.review
        ? await supabase().rpc('edit_my_review', { p_review_id: ctx.review.id, p_overall: overall, p_ratings: ratings, p_text: trimmed || undefined })
        : await supabase().rpc('submit_review', {
            p_booking_id: ctx.booking_id,
            p_overall: overall,
            p_ratings: ratings,
            p_text: trimmed || undefined,
            p_device_hash: await deviceId(),
            p_idempotency_key: idempotencyKey,
          });
    setBusy(false);
    if (e) return setError(describeError(e.message));
    setDone(data as { text_state: string | null });
    setEditing(false);
    void load();
  };
  const remove = () =>
    confirm('Delete your review?', 'This can’t be undone.', 'Delete', () => {
      void supabase().rpc('delete_my_review', { p_review_id: ctx!.review!.id }).then(({ error: e }) => {
        if (e) return setError(describeError(e.message));
        setDone(null);
        void load();
      });
    });

  if (!ctx) return <State loading={!error} error={error} />;
  const header = (
    <Card testID="review-visit">
      <Text style={{ fontWeight: '600' }}>{ctx.business.name}</Text>
      <Muted>{ctx.service}{ctx.staff_first_name ? ` · with ${ctx.staff_first_name}` : ''}</Muted>
      {ctx.trust_tier ? <Text style={{ color: C.success, fontSize: 12 }}>✓ {TIER[ctx.trust_tier]}</Text> : null}
    </Card>
  );

  if (ctx.review && !editing) {
    const r = ctx.review;
    return (
      <View style={{ gap: 12 }} testID="review-status">
        {header}
        {done ? <Body testID="review-thanks">Thanks! Your rating is live.{done.text_state === 'pending' ? ' Your comment will appear after a quick check.' : ''}</Body> : null}
        {r.status === 'deleted_by_author' ? <Muted>You deleted this review.</Muted> : (
          <>
            <Row><Text style={{ fontSize: 22, color: '#D08A00' }}>{'★'.repeat(r.overall)}</Text><Muted>{STAR_WORDS[r.overall]}</Muted></Row>
            {r.text ? <Body>{r.text}</Body> : null}
            <Muted testID="review-state">
              {r.rating_state === 'quarantined' ? 'Your review is being checked by our team.'
                : r.text_state === 'pending' ? 'Rating published · comment being checked'
                : r.text_state === 'rejected' || r.text_state === 'removed' ? 'Rating published · your comment couldn’t be published as written.'
                : r.text_state === 'manual_review' ? 'Rating published · comment waiting for a moderator' : 'Published'}
            </Muted>
            {r.status !== 'removed' ? <ResultUploader reviewId={r.id} service={ctx.service ?? ''} /> : null}
            {r.can_edit ? (
              <Button title="Edit review (once, within 7 days)" kind="secondary" testID="edit-review"
                onPress={() => { setOverall(r.overall); setRatings(r.ratings); setText(r.text ?? ''); setEditing(true); }} />
            ) : null}
            <Button title="Delete review" kind="danger" disabled={busy} onPress={remove} />
          </>
        )}
        <Link href={{ pathname: '/[slug]', params: { slug: ctx.business.slug } }} style={{ color: C.accent, fontWeight: '600' }}>Back to {ctx.business.name}</Link>
        {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}
      </View>
    );
  }
  if (!ctx.eligible && !editing) {
    return <View style={{ gap: 12 }}>{header}<Body testID="review-not-eligible">{describeError(ctx.reason ?? 'NOT_ELIGIBLE')}</Body></View>;
  }
  return (
    <View style={{ gap: 16 }} testID="review-form">
      {header}
      <H2>How was your visit?</H2>
      <StarInput value={overall} onChange={setOverall} label="Overall rating" />
      <Muted>{STAR_WORDS[overall] || ' '}</Muted>
      {overall > 0 && ctx.dimensions.length ? (
        <View style={{ gap: 8 }}>
          <Muted>Rate the details (optional)</Muted>
          {ctx.dimensions.map((d) => (
            <Row key={d.key}>
              <Text style={{ flex: 1, color: C.ink700 }}>{d.label_en}</Text>
              <StarInput size={24} label={d.label_en} value={ratings[d.key] ?? 0} onChange={(v) => setRatings((x) => ({ ...x, [d.key]: v }))} />
            </Row>
          ))}
        </View>
      ) : null}
      {overall > 0 ? (
        <View style={{ gap: 4 }}>
          <Field label="Tell others about it (optional)" value={text} onChangeText={setText} multiline maxLength={MAX}
            placeholder="What went well? What could be better?" style={{ minHeight: 110, textAlignVertical: 'top', paddingTop: 12 }} testID="review-text" />
          <Muted>{trimmed.length > 0 && trimmed.length < MIN ? `${MIN - trimmed.length} more characters` : 'Any language is fine. Don’t include phone numbers or other people’s full names.'}</Muted>
        </View>
      ) : null}
      <Button title={editing ? 'Save changes' : 'Post review'} busy={busy} disabled={overall < 1 || !textOk} onPress={() => void submit()} testID="submit-review" />
      {editing ? <Button title="Cancel" kind="secondary" onPress={() => setEditing(false)} /> : null}
      <Muted>Your first name and last initial are shown. The business can reply but can’t remove your review.</Muted>
      {error ? <Text style={{ color: C.danger }} testID="review-error">{error}</Text> : null}
    </View>
  );
}

interface MyMedia { id: string; media_id: string; state: string; reason: string | null; thumb: string | null }
type Local = { key: string; uri?: string; path?: string; mediaId?: string; phase: 'preparing' | 'uploading' | 'checking' | 'error'; error?: string };

/** Resize to ≤ 2048 px and re-encode as JPEG on the device — EXIF/GPS never leaves the phone. */
async function preparePhoto(a: ImagePicker.ImagePickerAsset) {
  if (Math.min(a.width, a.height) < 300) throw new Error('TOO_SMALL');
  const scale = Math.min(1, 2048 / Math.max(a.width, a.height));
  const out = await manipulateAsync(a.uri, scale < 1 ? [{ resize: { width: Math.round(a.width * scale) } }] : [], { compress: 0.9, format: SaveFormat.JPEG });
  return out.uri;
}

function ResultUploader({ reviewId, service }: { reviewId: string; service: string }) {
  const [agree, setAgree] = useState(false);
  const [consented, setConsented] = useState(false);
  const [media, setMedia] = useState<MyMedia[] | null>(null);
  const [local, setLocal] = useState<Local[]>([]);
  const [error, setError] = useState<string | null>(null);
  const polls = useRef(0);
  const load = useCallback(async () => {
    const { data, error: e } = await supabase().rpc('get_my_review_media', { p_review_id: reviewId });
    if (e) return setError(describeError(e.message));
    setMedia((data as unknown as MyMedia[]) ?? []);
  }, [reviewId]);
  useEffect(() => void load(), [load]);
  const checking = (media ?? []).some((m) => m.state === 'pending') || local.some((l) => l.phase === 'checking');
  useEffect(() => {
    if (!checking || polls.current > 60) return;
    const t = setTimeout(() => {
      polls.current += 1;
      void load().then(() => setLocal((xs) => xs.filter((l) => l.phase !== 'checking')));
    }, 4000);
    return () => clearTimeout(t);
  }, [checking, media, load]);

  const room = Math.max(0, 4 - (media ?? []).filter((m) => m.state !== 'rejected' && m.state !== 'removed').length - local.filter((l) => l.phase !== 'error').length);
  const patch = (key: string, p: Partial<Local>) => setLocal((xs) => xs.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const upload = async (item: Local) => {
    if (!item.uri || !item.path || !item.mediaId) return;
    patch(item.key, { phase: 'uploading', error: undefined });
    const body = await (await fetch(item.uri)).arrayBuffer();
    const { error: upErr } = await supabase().storage.from('ugc-private').upload(item.path, body, { contentType: 'image/jpeg', upsert: false });
    if (upErr && !/exists|duplicate/i.test(upErr.message)) return patch(item.key, { phase: 'error', error: 'Upload failed. Check your connection and retry.' });
    const { error: finErr } = await supabase().rpc('finalize_media_upload', { p_media_id: item.mediaId });
    if (finErr) return patch(item.key, { phase: 'error', error: describeError(finErr.message) });
    patch(item.key, { phase: 'checking' });
  };
  const choose = async () => {
    setError(null);
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 1, exif: false });
    if (res.canceled) return;
    const picked = res.assets.slice(0, room);
    const items: Local[] = picked.map((_, i) => ({ key: `${Date.now()}-${i}`, phase: 'preparing' }));
    setLocal((xs) => [...xs, ...items]);
    const ready: { item: Local; uri: string }[] = [];
    for (const [i, a] of picked.entries()) {
      try {
        const uri = await preparePhoto(a);
        ready.push({ item: items[i]!, uri });
        patch(items[i]!.key, { uri });
      } catch (e) {
        patch(items[i]!.key, { phase: 'error', error: (e as Error).message === 'TOO_SMALL' ? 'This photo is too small (at least 300 px).' : 'This file isn’t a photo we can open.' });
      }
    }
    if (!ready.length) return;
    const { data, error: e } = await supabase().rpc('request_review_media_upload', { p_review_id: reviewId, p_items: ready.map(() => ({ kind: 'result' })), p_consent_version: CONSENT_VERSION });
    if (e) return ready.forEach((r) => patch(r.item.key, { phase: 'error', error: describeError(e.message) }));
    const slots = data as unknown as { media_id: string; upload_path: string }[];
    await Promise.all(ready.map(async ({ item, uri }, i) => {
      const next = { ...item, uri, path: slots[i]!.upload_path, mediaId: slots[i]!.media_id };
      patch(item.key, { path: next.path, mediaId: next.mediaId });
      await upload(next);
    }));
  };
  const remove = (m: MyMedia) =>
    confirm('Remove this photo?', 'It disappears from the business page at once.', 'Remove', () =>
      void supabase().rpc('delete_my_media', { p_review_media_id: m.id }).then(({ error: e }) => (e ? setError(describeError(e.message)) : void load())));

  if (media === null) return null;
  const shown = media.filter((m) => m.state !== 'removed');
  const tile = { width: '47%' as const, gap: 4 };
  return (
    <Card testID="result-uploader">
      <H2>Share your result</H2>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {shown.map((m) => (
          <View key={m.id} style={tile} testID="my-photo">
            <View style={{ aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: C.surface100 }}>
              {m.thumb ? <Image source={{ uri: ugcUrl(m.thumb)! }} style={{ width: '100%', height: '100%' }} /> : null}
            </View>
            <Text style={{ fontSize: 12, color: m.state === 'rejected' ? C.danger : C.ink700 }}>
              {m.state === 'approved' ? 'Live on the business page' : m.state === 'rejected' ? `Not published. ${(PHOTO_REASONS[m.reason ?? ''] ?? "It doesn't follow our photo guidelines.").replace('{service}', service || 'service')}` : 'In review — usually a few minutes'}
            </Text>
            {m.state !== 'rejected' ? <Pressable onPress={() => remove(m)}><Text style={{ color: C.danger, fontSize: 12 }}>Remove</Text></Pressable> : null}
          </View>
        ))}
        {local.filter((l) => l.phase !== 'checking').map((l) => (
          <View key={l.key} style={tile} testID="upload-item">
            <View style={{ aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: C.surface100 }}>
              {l.uri ? <Image source={{ uri: l.uri }} style={{ width: '100%', height: '100%' }} /> : null}
            </View>
            <Text style={{ fontSize: 12, color: l.phase === 'error' ? C.danger : C.ink700 }}>{l.phase === 'error' ? l.error : l.phase === 'preparing' ? 'Preparing…' : 'Uploading…'}</Text>
            {l.phase === 'error' && l.mediaId ? <Pressable onPress={() => void upload(l)}><Text style={{ color: C.accent, fontSize: 12 }}>Retry</Text></Pressable> : null}
          </View>
        ))}
      </View>
      {room > 0 ? (
        consented ? (
          <Button title={shown.length || local.length ? `Add more photos (${room} left)` : 'Choose photos (up to 4)'} kind="secondary" onPress={() => void choose()} testID="choose-photos" />
        ) : (
          <View style={{ gap: 8 }} testID="photo-consent">
            <Body>Your photos may appear publicly on the business’s page and on APP_NAME, with your first name. Photos are checked before they appear.</Body>
            <Row><Switch value={agree} onValueChange={setAgree} accessibilityLabel="I have permission to share this image" /><Text style={{ flex: 1 }}>I have permission to share this image</Text></Row>
            <Button title="Continue" disabled={!agree} onPress={() => setConsented(true)} />
          </View>
        )
      ) : null}
      {error ? <Text style={{ color: C.danger }}>{error}</Text> : null}
    </Card>
  );
}
