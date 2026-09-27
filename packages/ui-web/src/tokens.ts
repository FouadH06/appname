/**
 * Design token roles from Phase 2 Part 1 §2. Roles are locked; hex values are placeholders
 * until branding. Each role is a CSS custom property `--<role>` defined in styles/tokens.css
 * for light mode and redefined for dark mode.
 */
export const COLOR_TOKENS = [
  'ink-900',
  'ink-700',
  'ink-500',
  'line-200',
  'surface-0',
  'surface-50',
  'surface-100',
  'accent-600',
  'trust-600', // reserved exclusively for verification marks
  'star-500',
  'success-600',
  'warning-600',
  'danger-600',
  'info-600',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export const RADIUS = { control: '6px', card: '10px', sheet: '14px' } as const;
