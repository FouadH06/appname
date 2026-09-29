// Renders every booking-message template with sample values through the real renderer
// (supabase/functions/_shared/notify/render.ts) → docs/notifications/templates.md for copy review.
// Usage: psql … -c "copy (select json_agg(t) from notification_templates t) to stdout" > t.json
//        node scripts/render-notification-copy.mjs t.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import {
  fill,
  replyText,
  formatVars,
  templateButtons,
  whatsappParams,
} from '../supabase/functions/_shared/notify/render.ts';

const templates = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const web = 'https://platform.com';
const sample = {
  booking_id: 'b-1',
  business_name: 'Fade District',
  service_name: 'Haircut',
  staff_name: 'Karim',
  customer_name: 'Moe',
  starts_at: '2026-10-13T13:30:00Z', // Tue 13 Oct, 16:30 Beirut
  old_starts_at: '2026-10-12T15:00:00Z',
  timezone: 'Asia/Beirut',
  link: `${web}/m/Xk3f9QpL2a`,
  link_token: 'Xk3f9QpL2a',
  business_slug: 'fade-district',
  business_url: `${web}/fade-district`,
  dashboard_path: 'b1d2/bookings',
  review_token: 'Rv7Tq2mZ9w',
  review_link: `${web}/review/Rv7Tq2mZ9w`,
};
const withReason = new Set(['request_declined', 'booking_cancelled_by_business']);
const ORDER = [
  ['booking_confirmed', 'Booking confirmed'],
  ['booking_requested', 'Booking request received'],
  ['request_accepted', 'Request accepted'],
  ['request_declined', 'Request declined'],
  ['request_expired', 'Request expired'],
  ['booking_reminder_24h', '24-hour reminder'],
  ['booking_reminder_2h', '2-hour reminder'],
  ['booking_rescheduled_by_business', 'Rescheduled booking'],
  ['staff_changed', 'Staff changed'],
  ['booking_cancelled_by_business', 'Business cancellation'],
  ['booking_cancelled_by_customer', 'Customer cancellation acknowledgement'],
  ['booking_no_show_marked', 'No-show'],
  ['biz_new_booking', 'Team alert: new online booking'],
  ['biz_new_request', 'Team alert: new request'],
  ['biz_booking_cancelled', 'Team alert: customer cancelled'],
  ['review_request', 'Review request (M9)'],
  ['review_needs_changes', 'Review comment needs changes (M9)'],
  ['biz_new_review', 'Team alert: new review (M9, owners/managers)'],
];
const URL = {
  view: `${web}/m/{token}`,
  book: `${web}/{business slug}`,
  dashboard: `${web}/biz/{business}/bookings`,
  review: `${web}/review/{token}`,
  review_edit: `${web}/review/{token}`,
  reviews: `${web}/biz/{business}/reviews`,
};

let md = `# Booking message copy (M7 + M9 reviews) — for review

Rendered with the real renderer and sample values: **Fade District**, Haircut with **Karim**,
**Tue 13 Oct at 4:30 PM** (moved from Mon 12 Oct at 6:00 PM), customer Moe.
Source of truth: \`scripts/notification-templates.py\` → \`supabase/migrations/20261003100100_m7_templates.sql\`
and (M9) \`supabase/migrations/20261005100200_m9_review_templates.sql\`.

- M9: the review request goes 2 hours after a completed visit, moved out of quiet hours (22:00–08:00);
  a visit logged by the business for someone without an account gets a claim link instead.

- **WhatsApp**: body text + buttons. Links are buttons (Meta doesn't allow links or variables at the
  start/end of a template body). *Confirm* / *Cancel* are quick replies: Confirm confirms attendance
  (only from the customer's number); Cancel replies with the booking link (never cancels directly).
- **SMS** (backup for booking messages): same text without emoji, with the link written out.
- Empty reason → "We're sorry for the inconvenience." / "نعتذر عن الإزعاج."
- *Change / Cancel* never cancels directly: the reply sends the booking page link (below), where the
  customer sees the cancellation policy first.
- The customer-cancellation acknowledgement is sent only after the cancellation succeeds (not for
  account deletions).
`;

for (const [type, title] of ORDER) {
  md += `\n## ${title} \`${type}\`\n`;
  for (const locale of ['en', 'ar']) {
    const payload = {
      ...sample,
      ...(withReason.has(type) && locale === 'en' ? { reason: 'Karim is off sick' } : {}),
      ...(withReason.has(type) && locale === 'ar' ? { reason: 'كريم مريض' } : {}),
    };
    const vars = formatVars(payload, locale);
    const wa = templates.find(
      (t) => t.type === type && t.channel === 'whatsapp' && t.locale === locale,
    );
    const sms = templates.find(
      (t) => t.type === type && t.channel === 'sms' && t.locale === locale,
    );
    const text = fill(wa.body, vars);
    const buttons = templateButtons(wa, payload).map((b, i) => {
      const label = wa.button_labels[i];
      return b.kind === 'quick_reply' ? `[ ${label} ]` : `[ ${label} ↗ ](${URL[wa.buttons[i]]})`;
    });
    md += `\n**${locale === 'en' ? 'English' : 'Arabic'} — WhatsApp** (template \`${wa.provider_template_name}\`, ${whatsappParams(wa, vars).length} parameters)\n\n`;
    md += '> ' + text + '\n>\n> ' + buttons.join('  ') + '\n';
    if (sms)
      md += `\n**${locale === 'en' ? 'English' : 'Arabic'} — SMS**\n\n> ${fill(sms.body, vars)}\n`;
  }
}
md += `
## Replies to button taps (sent in the customer's open WhatsApp session)
`;
for (const [kind, title] of [
  ['confirmed', 'After Confirm'],
  ['cancel_link', 'After Change / Cancel'],
  ['cannot_confirm', 'Confirm on a booking that can no longer be confirmed'],
  ['not_yours', 'Tap from a different number'],
]) {
  md += `
**${title}**

`;
  for (const locale of ['en', 'ar'])
    md += `> ${replyText({ ...sample, reply: kind, locale })}

`;
}
mkdirSync('docs/notifications', { recursive: true });
writeFileSync('docs/notifications/templates.md', md);
console.log('docs/notifications/templates.md written');
