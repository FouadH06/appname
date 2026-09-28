import { notFound } from 'next/navigation';
import { LabBooking } from './lab-booking';

// M4 manual-test page: anonymous hold → phone code → confirm, in real browsers and in-app browsers.
// Enabled only when NEXT_PUBLIC_ENABLE_LAB=true (local / staging test deployments).
export default async function LabBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ loc?: string; svc?: string }>;
}) {
  const { loc, svc } = await searchParams; // request-time page (never prerendered)
  if (process.env.NEXT_PUBLIC_ENABLE_LAB !== 'true' || !loc || !svc) notFound();
  return <LabBooking locationId={loc} serviceId={svc} />;
}
