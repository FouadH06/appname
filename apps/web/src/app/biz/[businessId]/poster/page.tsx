'use client';

import QRCode from 'qrcode';
import { useBiz } from '@/lib/biz/context';
import { bookingUrl, bookingUrlLabel } from '@/lib/biz/site';
import { useLoad } from '@/lib/biz/use-load';

// Counter poster (A4/A5): print or "Save as PDF" from the browser's print dialog.
export default function PosterPage() {
  const { business } = useBiz();
  const url = bookingUrl(business.slug);
  const { data: qr } = useLoad(() => QRCode.toDataURL(url, { margin: 1, width: 900 }), [url]);
  return (
    <div className="bg-surface-0">
      <style>{`@media print { @page { size: A4; margin: 16mm } nav, aside, header, .no-print { display: none !important } main { padding: 0 !important } }`}</style>
      <div className="no-print flex justify-end gap-2 p-4">
        <button
          type="button"
          onClick={() => window.print()}
          className="h-10 rounded-control bg-accent-600 px-4 text-sm font-semibold text-white"
        >
          Print / Save as PDF
        </button>
      </div>
      <article
        className="mx-auto flex max-w-[180mm] flex-col items-center gap-6 px-6 pb-16 text-center"
        data-testid="poster"
      >
        <h1 className="text-4xl font-bold">{business.name}</h1>
        <p className="text-2xl">Book your next visit online</p>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- generated data URL
          <img src={qr} alt="QR code" className="size-[110mm] max-w-full" />
        ) : null}
        <p className="font-mono text-xl">{bookingUrlLabel(business.slug)}</p>
        <p className="text-lg text-ink-700">
          Scan with your camera · pick a time · get a WhatsApp confirmation
        </p>
        <p dir="rtl" lang="ar" className="text-lg text-ink-700">
          امسح الرمز واحجز موعدك أونلاين
        </p>
      </article>
    </div>
  );
}
