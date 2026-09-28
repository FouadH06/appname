'use client';

import Link from 'next/link';
import QRCode from 'qrcode';
import { useState } from 'react';
import { useBiz } from '@/lib/biz/context';
import { bookingUrl, bookingUrlLabel } from '@/lib/biz/site';
import { useLoad } from '@/lib/biz/use-load';
import { Section, btn } from '../ui';

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={btn.secondary}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setDone(true))}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

/** Share kit (Phase 2 B1 step 10 / B12): link, QR poster, Instagram bio, WhatsApp auto-reply. */
export function ShareSection() {
  const { business } = useBiz();
  const url = bookingUrl(business.slug);
  const { data: qr } = useLoad(() => QRCode.toDataURL(url, { margin: 1, width: 480 }), [url]);
  const autoReply = `Hi! You can book directly here: ${bookingUrlLabel(business.slug)} — pick your time and you'll get a WhatsApp confirmation.`;

  return (
    <Section
      title="Booking link & share kit"
      description="Put your link everywhere customers already find you."
    >
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-control bg-surface-50 px-3 py-2 text-sm" data-testid="share-link">
          {bookingUrlLabel(business.slug)}
        </code>
        <Copy text={url} label="Copy link" />
      </div>
      <div className="flex flex-wrap items-start gap-4">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- generated data URL
          <img
            src={qr}
            alt="QR code for your booking link"
            className="size-40 rounded-control border border-line-200"
          />
        ) : null}
        <div className="flex flex-col gap-2 text-sm">
          <Link href={`/biz/${business.id}/poster`} className={btn.primary} target="_blank">
            QR poster for the counter (print / PDF)
          </Link>
          {qr ? (
            <a className={btn.secondary} href={qr} download={`${business.slug}-qr.png`}>
              Download QR image
            </a>
          ) : null}
        </div>
      </div>
      <div className="text-sm">
        <p className="font-medium">Instagram bio</p>
        <p className="text-ink-700">
          Edit profile → Links → Add external link → paste your booking link. Add “Book online 👇”
          to your bio.
        </p>
      </div>
      <div className="text-sm">
        <p className="font-medium">
          WhatsApp auto-reply (WhatsApp Business → Away/Greeting message)
        </p>
        <p className="my-1 rounded-control bg-surface-50 p-2 text-ink-700">{autoReply}</p>
        <Copy text={autoReply} label="Copy text" />
      </div>
    </Section>
  );
}
