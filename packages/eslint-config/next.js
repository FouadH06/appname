import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import base from './base.js';

/** Flat config for the Next.js apps (web, admin). */
export default tseslint.config(
  ...base,
  nextPlugin.configs['core-web-vitals'],
  reactHooks.configs.flat.recommended,
);
