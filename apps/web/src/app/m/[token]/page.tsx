import { ClaimClient } from './claim-client';

// WhatsApp link for a business-created booking (Phase 2 §8.1 /m/{token}; Part 2 §2.3 Flow A).
export default async function BookingLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ClaimClient token={token} />;
}
