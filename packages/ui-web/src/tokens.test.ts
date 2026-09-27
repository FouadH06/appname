import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLOR_TOKENS } from './tokens';

const css = readFileSync(fileURLToPath(new URL('./styles/tokens.css', import.meta.url)), 'utf8');

function block(selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `missing selector ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('design tokens', () => {
  it.each(COLOR_TOKENS)('defines --%s for light and both dark-mode selectors', (token) => {
    expect(block(':root {')).toContain(`--${token}:`);
    expect(block(":root:not([data-theme='light'])")).toContain(`--${token}:`);
    expect(block(":root[data-theme='dark']")).toContain(`--${token}:`);
    expect(css).toContain(`--color-${token}: var(--${token})`);
  });
});
