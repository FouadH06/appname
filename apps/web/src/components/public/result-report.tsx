'use client';

import { useState } from 'react';
import { PhoneSignIn } from '@/components/phone-sign-in';
import { describeError } from '@/lib/copy';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

// C6 report link: "Inappropriate", "Not a real result", "My photo — remove it" (signed-in visitors)
const REASONS: [string, string][] = [
  ['inappropriate', 'Inappropriate'],
  ['fake_review', 'Not a real result'],
  ['my_photo', 'This is my photo — remove it'],
];

export function ReportResult({ resultId }: { resultId: string }) {
  const { loading, signedIn } = useSession();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent) return <p className="text-sm text-ink-700">Thanks — our team will look at it.</p>;
  if (!open) {
    return (
      <button
        type="button"
        className="self-start text-xs text-ink-500 hover:underline"
        onClick={() => setOpen(true)}
        data-testid="report-result"
      >
        Report this result
      </button>
    );
  }
  if (loading) return null;
  if (!signedIn) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>Verify your phone to report.</p>
        <PhoneSignIn onVerified={() => undefined} />
      </div>
    );
  }
  const send = async () => {
    const { error: e } = await supabase().rpc('report_content', {
      p_subject_type: 'review_media',
      p_subject_id: resultId,
      p_reason: reason as 'other',
      p_parts: ['whole'],
    });
    if (e) return setError(describeError(e.message));
    setSent(true);
  };
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line-200 p-3 text-sm">
      {REASONS.map(([v, label]) => (
        <label key={v} className="flex items-center gap-2">
          <input
            type="radio"
            name="result-report"
            checked={reason === v}
            onChange={() => setReason(v)}
          />
          {label}
        </label>
      ))}
      <button
        type="button"
        className="h-10 rounded-control bg-accent-600 font-semibold text-white disabled:opacity-50"
        disabled={!reason}
        onClick={() => void send()}
      >
        Send report
      </button>
      {error ? <p className="text-danger-600">{error}</p> : null}
    </div>
  );
}
