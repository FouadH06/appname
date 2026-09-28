// Pure helpers behind the auth components (unit-tested without a DOM).

export const OTP_LENGTH = 6;
/** "Send by SMS instead" appears after this many seconds (Phase 2 C10; Auth's resend interval). */
export const RESEND_AFTER_SECONDS = 30;

/** Keeps digits only (Arabic-Indic digits converted), at most 6. Handles pasted "123 456" or "Code: 123456". */
export function sanitizeOtp(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/\D/g, '')
    .slice(0, OTP_LENGTH);
}

export type FlowStep = 'phone' | 'code' | 'done';

export interface FlowState {
  step: FlowStep;
  phone: string | null;
  channel: 'whatsapp' | 'sms';
  sends: number;
  busy: boolean;
  error: string | null;
}

export type FlowEvent =
  | { type: 'send'; phone: string }
  | { type: 'sent' }
  | { type: 'resend' }
  | { type: 'resent'; channel: 'whatsapp' | 'sms' }
  | { type: 'verify' }
  | { type: 'verified' }
  | { type: 'failed'; error: string }
  | { type: 'change_number' };

export const initialFlow: FlowState = {
  step: 'phone',
  phone: null,
  channel: 'whatsapp',
  sends: 0,
  busy: false,
  error: null,
};

/**
 * Phone → code → done. The first code is announced as WhatsApp; a resend for a Lebanese number
 * is announced as SMS (the server routes a resend after 30 s to SMS). Foreign numbers resend by
 * WhatsApp (SMS fallback is limited to allowed countries).
 */
export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'send':
      return { ...state, phone: event.phone, busy: true, error: null };
    case 'sent':
      return { ...state, step: 'code', channel: 'whatsapp', sends: state.sends + 1, busy: false };
    case 'resend':
    case 'verify':
      return { ...state, busy: true, error: null };
    case 'resent':
      return { ...state, channel: event.channel, sends: state.sends + 1, busy: false };
    case 'verified':
      return { ...state, step: 'done', busy: false, error: null };
    case 'failed':
      return { ...state, busy: false, error: event.error };
    case 'change_number':
      return { ...initialFlow };
  }
}

export function secondsLeft(
  sentAtMs: number,
  nowMs: number,
  waitSeconds = RESEND_AFTER_SECONDS,
): number {
  return Math.max(0, Math.ceil((sentAtMs + waitSeconds * 1000 - nowMs) / 1000));
}
