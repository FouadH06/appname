import { Link } from 'expo-router';
import type { ReactNode } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LABELS, dateTimeText, durationText, mediaUrl, money } from '@/lib/format';
import type { SearchCard } from '@/lib/types';

// Small app UI kit (M13). Colors follow the web tokens (accent, ink, line, surface).
export const C = {
  accent: '#C8553D',
  ink900: '#1F1B18',
  ink700: '#4A433E',
  ink500: '#7A716A',
  line: '#E6E0DA',
  surface0: '#FFFFFF',
  surface50: '#FAF7F4',
  surface100: '#F2EDE8',
  danger: '#B42318',
  success: '#157F3C',
};

/** Destructive confirm. react-native-web's Alert is a no-op, so the web build uses window.confirm. */
export function confirmAction(title: string, message: string, ok: string, run: () => void, cancel = 'Cancel') {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}

${message}`)) run();
    return;
  }
  Alert.alert(title, message, [{ text: cancel, style: 'cancel' }, { text: ok, style: 'destructive', onPress: run }]);
}

export function Screen({ children, scroll = true, testID }: { children: ReactNode; scroll?: boolean; testID?: string }) {
  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']} testID={testID}>
      {scroll ? <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={[s.body, { flex: 1 }]}>{children}</View>}
    </SafeAreaView>
  );
}

export const H1 = ({ children }: { children: ReactNode }) => <Text style={s.h1} accessibilityRole="header">{children}</Text>;
export const H2 = ({ children }: { children: ReactNode }) => <Text style={s.h2} accessibilityRole="header">{children}</Text>;
export const Muted = ({ children, testID }: { children: ReactNode; testID?: string }) => <Text style={s.muted} testID={testID}>{children}</Text>;
export const Body = ({ children, testID }: { children: ReactNode; testID?: string }) => <Text style={s.text} testID={testID}>{children}</Text>;

export function Button({ title, onPress, kind = 'primary', disabled, testID, busy }: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  const bg = kind === 'primary' ? C.accent : C.surface0;
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? C.danger : C.ink900;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderColor: kind === 'primary' ? C.accent : C.line, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, active, onPress, testID, disabled }: { label: string; active?: boolean; onPress?: () => void; testID?: string; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!active, disabled: !!disabled }} disabled={disabled} onPress={onPress} testID={testID}
      style={[s.chip, active ? { backgroundColor: C.accent, borderColor: C.accent } : null, disabled ? { opacity: 0.5 } : null]}>
      <Text style={{ color: active ? '#fff' : C.ink900, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style, testID }: { children: ReactNode; style?: ViewStyle; testID?: string }) {
  return <View style={[s.card, style]} testID={testID}>{children}</View>;
}

export function Field(props: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.label}>{props.label}</Text>
      <TextInput {...props} accessibilityLabel={props.label} style={[s.input, props.style]} placeholderTextColor={C.ink500} />
    </View>
  );
}

export const Row = ({ children, gap = 8, wrap }: { children: ReactNode; gap?: number; wrap?: boolean }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: wrap ? 'wrap' : 'nowrap' }}>{children}</View>
);

export function State({ loading, error, empty, emptyText }: { loading?: boolean; error?: string | null; empty?: boolean; emptyText?: string }) {
  if (error) return <Text style={[s.text, { color: C.danger }]} accessibilityRole="alert">{error}</Text>;
  if (loading) return <ActivityIndicator style={{ marginVertical: 24 }} color={C.accent} />;
  if (empty) return <Text style={s.muted} testID="empty">{emptyText ?? 'Nothing here yet.'}</Text>;
  return null;
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return <Text style={{ color: C.accent, fontSize: size }}>{'★'.repeat(Math.round(value))}<Text style={{ color: C.line }}>{'★'.repeat(5 - Math.round(value))}</Text></Text>;
}

/** C4 BusinessCard (compact on rails). Tapping opens the business profile (with the service preselected).
 *  Link asChild on web forwards style to the anchor, which can't take an array, so it's flattened. */
export function BusinessCard({ c, compact }: { c: SearchCard; compact?: boolean }) {
  const cover = mediaUrl(c.cover_path);
  const next = c.service?.next ?? c.next_available_at;
  return (
    <Link href={{ pathname: '/[slug]', params: { slug: c.slug, ...(c.service ? { service: c.service.service_id } : {}) } }} asChild>
      <Pressable style={StyleSheet.flatten([s.card, { padding: 0, overflow: 'hidden' as const, width: compact ? 220 : undefined }])} testID="business-card" accessibilityRole="link">
        <View style={{ height: compact ? 96 : 130, backgroundColor: C.surface100 }}>
          {cover ? <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} /> : null}
        </View>
        <View style={{ padding: 12, gap: 4 }}>
          <Text style={s.cardTitle} numberOfLines={1}>{c.name}</Text>
          <Text style={s.muted} numberOfLines={1}>
            {c.display_rating ? `★ ${c.display_rating} (${c.review_count})` : 'New'} · {c.area}
            {c.price_level ? ` · ${'$'.repeat(c.price_level)}` : ''}
          </Text>
          {c.labels.length ? <Text style={[s.muted, { color: C.ink700 }]} numberOfLines={1}>{c.labels.map((l) => LABELS[l] ?? l).join(' · ')}</Text> : null}
          {c.service ? (
            <Text style={s.text} numberOfLines={1} testID="card-service">
              {c.service.name} · {c.service.type === 'on_consultation' ? 'Price on consultation' : `${c.service.type === 'from' ? 'from ' : ''}${money(c.service.min)}`} · {durationText(c.service.duration)}
            </Text>
          ) : null}
          <Text style={{ color: C.accent, fontSize: 13 }}>{next ? `Next: ${dateTimeText(next)}` : 'See times'}</Text>
        </View>
      </Pressable>
    </Link>
  );
}

export function Rail({ title, cards, testID }: { title: string; cards: SearchCard[]; testID?: string }) {
  if (cards.length < 3) return null; // C2: sections with fewer than 3 items are hidden
  return (
    <View style={{ gap: 8 }} testID={testID}>
      <H2>{title}</H2>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
        {cards.map((c) => <BusinessCard key={c.location_id} c={c} compact />)}
      </ScrollView>
    </View>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.surface50 },
  body: { padding: 16, gap: 16, paddingBottom: 48 },
  h1: { fontSize: 24, fontWeight: '700', color: C.ink900 },
  h2: { fontSize: 18, fontWeight: '600', color: C.ink900 },
  text: { fontSize: 15, color: C.ink900 },
  muted: { fontSize: 13, color: C.ink500 },
  label: { fontSize: 13, color: C.ink700, fontWeight: '500' },
  btn: { minHeight: 48, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnText: { fontSize: 16, fontWeight: '600' },
  chip: { borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.surface0 },
  card: { backgroundColor: C.surface0, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: C.ink900 },
  input: { minHeight: 48, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: C.ink900, backgroundColor: C.surface0 },
});
