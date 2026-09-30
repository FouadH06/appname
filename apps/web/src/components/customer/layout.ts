import { messages } from '@app/i18n';

// Shared, non-client constants for the customer surface (importable from server components).

/** Product name from the i18n catalogue (placeholder until branding). */
export const BRAND = messages.en.app.name;

/** Content width for every customer page: generous on desktop, never edge to edge on wide screens. */
export const container = 'mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-8';
