import type { Lang } from './types.ts';

// Arabic-Indic (٠–٩) and Extended Arabic-Indic (۰–۹) digits → 0–9, one character for one, so
// positions found on the normalized text are valid positions in the original.
export function latinDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (d) =>
    String((d.charCodeAt(0) - (d >= '۰' ? 0x06f0 : 0x0660)) % 10),
  );
}

const DIACRITICS = /[ً-ٰٟـ]/g; // harakat, superscript alef, tatweel

/** For rules, duplicate detection and the classifier: NFC, no diacritics/tatweel, Latin digits, lowercase, single spaces. */
export function normalizeText(text: string): string {
  return latinDigits(text.normalize('NFC'))
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const ARABIZI_WORDS = new Set(
  (
    'ktir kteer ktiir mni7 mnih mne7 7elo 7elwe 7ilo helo 7lo yalla yallah bas shi chi 3am 3an 3ala ' +
    'kel kil ahla ahlan tayyib zbat wlk walla wallah akid habibi 7abibi ma3 mafi fi fina baddak badde ' +
    'ra2e3 ra2i3 3ajib 3ajeeb 5ara sa7 ma32ool zaki tayeb hek heik lezem lezim kamen kamein mech mish msh ' +
    'marra mara ktiir2 3anjad jad tamem tamam barke 2abl ba3d 3tine 2alb'
  ).split(' '),
);
const FRENCH_WORDS = new Set(
  'très tres merci bonjour bien avec mais pas est une les des pour très super génial genial service accueil personnel propre sale cher'.split(
    ' ',
  ),
);

function isArabiziToken(t: string): boolean {
  if (ARABIZI_WORDS.has(t)) return true;
  // Latin letters with the Arabizi digits 2 3 5 7 8 9 inside or at the start (7elo, 3ajib, ma32ool)
  return /^[a-z]*[235789][a-z]+[235789a-z]*$/.test(t) && /[a-z]{2}/.test(t);
}

/** Languages present (a text may have several: Arabic + English + Arabizi is common in Lebanon). */
export function detectLangs(text: string): Lang[] {
  const n = normalizeText(text);
  const arabic = (n.match(/[؀-ۿ]/g) ?? []).length;
  const tokens = n.match(/[a-z0-9À-ſ']+/g) ?? [];
  const letters = tokens.filter((t) => /[a-zÀ-ſ]/.test(t));
  const arabizi = letters.filter(isArabiziToken).length;
  const french = letters.filter((t) => FRENCH_WORDS.has(t) || /[éèêàçùâîôû]/.test(t)).length;
  const latin = letters.length - arabizi - french;

  const out: Lang[] = [];
  if (arabic >= 3) out.push('ar');
  if (arabizi >= 1 && arabizi >= letters.length * 0.2) out.push('arabizi');
  if (french >= 2 || (french >= 1 && letters.length <= 6)) out.push('fr');
  if (latin >= 2 || (out.length === 0 && letters.length > 0)) out.push('en');
  return out.length ? out : ['en'];
}

// Rough Arabizi → Arabic script, to help the classifier and reviewers (not shown to anyone).
const DIGRAPHS: [RegExp, string][] = [
  [/sh|ch/g, 'ش'],
  [/kh/g, 'خ'],
  [/gh/g, 'غ'],
  [/th/g, 'ث'],
  [/dh/g, 'ذ'],
];
const SINGLE: Record<string, string> = {
  '2': 'ء',
  '3': 'ع',
  '5': 'خ',
  '7': 'ح',
  '8': 'ق',
  '9': 'ص',
  a: 'ا',
  b: 'ب',
  t: 'ت',
  j: 'ج',
  d: 'د',
  r: 'ر',
  z: 'ز',
  s: 'س',
  f: 'ف',
  q: 'ق',
  k: 'ك',
  l: 'ل',
  m: 'م',
  n: 'ن',
  h: 'ه',
  w: 'و',
  o: 'و',
  u: 'و',
  y: 'ي',
  i: 'ي',
  e: 'ي',
  g: 'ج',
  p: 'ب',
  v: 'ف',
};

export function arabiziToArabic(text: string): string | null {
  let changed = false;
  const out = normalizeText(text).replace(/[a-z0-9']+/g, (tok) => {
    if (!isArabiziToken(tok)) return tok;
    changed = true;
    let w = tok.replace(/'/g, '');
    for (const [re, ar] of DIGRAPHS) w = w.replace(re, ar);
    return [...w].map((c) => SINGLE[c] ?? c).join('');
  });
  return changed ? out : null;
}
