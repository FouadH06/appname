// Public booking URL. Placeholder domain until the real one is chosen (locked decision: platform.com/{slug}).
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://platform.com').replace(
  /\/$/,
  '',
);

export const bookingUrl = (slug: string) => `${SITE_URL}/${slug}`;
export const bookingUrlLabel = (slug: string) => bookingUrl(slug).replace(/^https?:\/\//, '');
