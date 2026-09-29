import { ReviewTokenClient } from './review-client';

// C15 · review link from WhatsApp/SMS (/review/{token}): verify the phone, claim a business-logged
// visit if needed, then rate it.
export default async function ReviewLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ReviewTokenClient token={token} />;
}
