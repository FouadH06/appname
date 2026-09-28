import { ImageResponse } from 'next/og';
import { getBusinessPage } from '@/lib/public/server';
import type { BusinessPage } from '@/lib/public/types';

// Link preview for platform.com/{slug} (WhatsApp / Instagram / iMessage): name, category, area.
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 3600;

export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await getBusinessPage(slug.toLowerCase());
  const p = r.state === 'ok' ? (r as BusinessPage) : null;
  const name = p?.business.name ?? 'APP_NAME';
  const line = p
    ? [p.business.category?.en, p.location.area?.en].filter(Boolean).join(' · ')
    : 'Book local services in Lebanon';
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: 72,
        background: 'linear-gradient(135deg, #1f2937 0%, #c2410c 100%)',
        color: 'white',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1 }}>{name}</div>
      <div style={{ fontSize: 36, marginTop: 20, opacity: 0.9 }}>{line}</div>
      <div style={{ fontSize: 30, marginTop: 40, opacity: 0.8 }}>
        Book online · see prices and free times
      </div>
    </div>,
    size,
  );
}
