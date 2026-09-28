import { notFound, permanentRedirect } from 'next/navigation';
import { Suspense } from 'react';
import { BookingFlow } from '@/components/public/booking-flow';
import { getBusinessPage } from '@/lib/public/server';
import type { BusinessPage } from '@/lib/public/types';

// C7–C10 booking flow (/{slug}/book?service=&staff=&start=). The business payload comes from the
// same cached read as the business page; availability and holds are live.
export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await getBusinessPage(slug.toLowerCase());
  if ('redirect_to' in r && r.redirect_to) permanentRedirect(`/${r.redirect_to}/book`);
  if (r.state !== 'ok') notFound();
  const page = r as BusinessPage;
  if (!page.accepting) permanentRedirect(`/${page.business.slug}`);
  return (
    <Suspense fallback={<p className="p-4 text-sm text-ink-500">Loading…</p>}>
      <BookingFlow page={page} />
    </Suspense>
  );
}
