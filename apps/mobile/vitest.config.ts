import { defineConfig } from 'vitest/config';

// Unit tests only; the app flows run in Playwright (e2e/) against the web build.
export default defineConfig({ test: { exclude: ['e2e/**', 'node_modules/**', 'dist/**'] } });
