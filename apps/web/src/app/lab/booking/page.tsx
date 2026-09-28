import { notFound } from 'next/navigation';
import { getPublicEnv } from '@/env';
import { LabBooking } from './lab-booking';

// M4 manual-test page: anonymous hold → phone code → confirm, in real browsers and in-app browsers.
// Enabled only when NEXT_PUBLIC_ENABLE_LAB=true (local / staging test deployments).
export default async function LabBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ loc?: string; svc?: string }>;
}) {
  if (getPublicEnv().NEXT_PUBLIC_ENABLE_LAB !== 'true') notFound();
  const { loc, svc } = await searchParams;
  if (!loc || !svc) notFound();
  return <LabBooking locationId={loc} serviceId={svc} />;
}
