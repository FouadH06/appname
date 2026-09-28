"""Source of truth for booking-message copy (M7). Regenerates
supabase/migrations/20261003100100_m7_templates.sql and docs/notifications/templates.md.

WhatsApp rules we follow (Meta): the body can't start or end with a variable, has no links (they go
in URL buttons with a dynamic suffix) and every parameter must be non-empty.
Run: python scripts/notification-templates.py
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

LABELS = {
    'confirm': ('Confirm', 'تأكيد'),
    'cancel': ('Change / Cancel', 'تعديل / إلغاء'),
    'view': ('View booking', 'عرض الحجز'),
    'book': ('Book another time', 'احجز موعدًا آخر'),
    'dashboard': ('Open bookings', 'فتح الحجوزات'),
}
# URL button targets (dynamic suffix = {{1}}), registered with each template at Meta
URLS = {'view': '{web}/m/{{1}}', 'book': '{web}/{{1}}', 'dashboard': '{web}/biz/{{1}}'}
# SMS: the link line that replaces the URL button
SMS_LINK = {
    'view': ('Your booking: {link}', 'حجزك: {link}'),
    'remind': ('Confirm or change: {link}', 'للتأكيد أو التعديل: {link}'),
    'book': ('Book again: {business_url}', 'احجز من جديد: {business_url}'),
}

# type: (EN body, AR body, buttons, sms link kind or None, customer-facing)
T = {
    'booking_confirmed': (
        "✅ You're booked at {business_name}: {service_name} with {staff_name}, {date} at {time}. We'll send you a reminder before your visit.",
        "✅ تم تأكيد حجزك في {business_name}: {service_name} مع {staff_name}، {date} الساعة {time}. سنرسل لك تذكيرًا قبل موعدك.",
        ['view'], 'view', True),
    'booking_requested': (
        "Thanks! {business_name} received your request for {service_name} on {date} at {time}. We'll let you know as soon as they reply.",
        "شكرًا! استلم {business_name} طلبك لخدمة {service_name} يوم {date} الساعة {time}. سنخبرك فور ردّهم.",
        ['view'], 'view', True),
    'request_accepted': (
        "✅ Good news! {business_name} confirmed your {service_name} with {staff_name}, {date} at {time}. See you then.",
        "✅ خبر سار! أكّد {business_name} موعد {service_name} مع {staff_name}، {date} الساعة {time}. نراك قريبًا.",
        ['view'], 'view', True),
    'request_declined': (
        "Sorry, {business_name} can't take your request for {date} at {time}. {reason} You can choose another time on their booking page.",
        "نعتذر، لا يستطيع {business_name} قبول طلبك ليوم {date} الساعة {time}. {reason} يمكنك اختيار وقت آخر من صفحة الحجز الخاصة بهم.",
        ['book'], 'book', True),
    'request_expired': (
        "Sorry, {business_name} didn't reply in time to your request for {date} at {time}. Your request expired. You can choose another time on their booking page.",
        "نعتذر، لم يردّ {business_name} في الوقت المحدد على طلبك ليوم {date} الساعة {time}. انتهت صلاحية طلبك. يمكنك اختيار وقت آخر من صفحة الحجز الخاصة بهم.",
        ['book'], 'book', True),
    'booking_reminder_24h': (
        "⏰ Reminder: {service_name} at {business_name} tomorrow, {date} at {time}, with {staff_name}. Please tap Confirm if you're coming.",
        "⏰ تذكير: {service_name} في {business_name} غدًا، {date} الساعة {time}، مع {staff_name}. اضغط «تأكيد» إذا كنت ستحضر.",
        ['confirm', 'cancel', 'view'], 'remind', True),
    'booking_reminder_2h': (
        "See you soon! {service_name} at {business_name} today at {time} with {staff_name}. Please confirm that you're still coming.",
        "نراك قريبًا! {service_name} في {business_name} اليوم الساعة {time} مع {staff_name}. يرجى تأكيد أنك ما زلت قادمًا.",
        ['confirm', 'cancel', 'view'], 'remind', True),
    'booking_rescheduled_by_business': (
        "📅 Your appointment at {business_name} has moved. {service_name} is now on {date} at {time} (it was {old_date} at {old_time}). If the new time doesn't suit you, you can change or cancel it from your booking.",
        "📅 تم تغيير موعدك في {business_name}. أصبح موعد {service_name} يوم {date} الساعة {time} (بدلًا من {old_date} الساعة {old_time}). إذا لم يناسبك الوقت الجديد، يمكنك تعديله أو إلغاؤه من صفحة الحجز.",
        ['view'], 'view', True),
    'staff_changed': (
        "Update from {business_name}: your {service_name} on {date} at {time} will now be with {staff_name}. If you'd rather change it, you can do so from your booking.",
        "تحديث من {business_name}: موعد {service_name} يوم {date} الساعة {time} سيكون الآن مع {staff_name}. إذا أردت تغييره، يمكنك ذلك من صفحة الحجز.",
        ['view'], 'view', True),
    'booking_cancelled_by_business': (
        "Sorry, {business_name} had to cancel your {service_name} on {date} at {time}. {reason} You can book another time on their booking page.",
        "نعتذر، اضطر {business_name} إلى إلغاء موعد {service_name} يوم {date} الساعة {time}. {reason} يمكنك حجز وقت آخر من صفحة الحجز الخاصة بهم.",
        ['book'], 'book', True),
    'booking_cancelled_by_customer': (
        "Your {service_name} booking at {business_name} on {date} at {time} has been cancelled.",
        "تم إلغاء حجز {service_name} في {business_name} يوم {date} الساعة {time}.",
        ['book'], 'book', True),
    'booking_no_show_marked': (
        "Hi, {business_name} recorded that you missed your {service_name} on {date} at {time}. If this is a mistake, open your booking to let us know.",
        "مرحبًا، سجّل {business_name} أنك لم تحضر موعد {service_name} يوم {date} الساعة {time}. إذا كان ذلك خطأ، افتح صفحة الحجز لإبلاغنا.",
        ['view'], 'view', True),
    # business alerts (WhatsApp only)
    'biz_new_booking': (
        "📅 New booking: {customer_name}, {service_name} with {staff_name}, {date} at {time}.",
        "📅 حجز جديد: {customer_name}، {service_name} مع {staff_name}، {date} الساعة {time}.",
        ['dashboard'], None, False),
    'biz_new_request': (
        "⏳ New request waiting for your answer: {customer_name}, {service_name}, {date} at {time}. Accept or decline it in your bookings.",
        "⏳ طلب جديد بانتظار ردّك: {customer_name}، {service_name}، {date} الساعة {time}. اقبله أو ارفضه من صفحة الحجوزات.",
        ['dashboard'], None, False),
    'biz_booking_cancelled': (
        "❌ Cancelled by the customer: {customer_name}, {service_name} with {staff_name}, {date} at {time}. The time is free again.",
        "❌ ألغى الزبون: {customer_name}، {service_name} مع {staff_name}، {date} الساعة {time}. أصبح الوقت متاحًا من جديد.",
        ['dashboard'], None, False),
}

EMOJI = re.compile('[\\u2300-\\u23ff\\u2600-\\u27bf\\U0001F300-\\U0001FAFF]\\ufe0f?\\s*')

# SMS wording where the WhatsApp text refers to buttons (SMS has none)
SMS_OVERRIDE = {
    'booking_reminder_24h': (
        "Reminder: {service_name} at {business_name} tomorrow, {date} at {time}, with {staff_name}. Confirm or change: {link}",
        "تذكير: {service_name} في {business_name} غدًا، {date} الساعة {time}، مع {staff_name}. للتأكيد أو التعديل: {link}"),
    'booking_reminder_2h': (
        "See you soon! {service_name} at {business_name} today at {time} with {staff_name}. Your booking: {link}",
        "نراك قريبًا! {service_name} في {business_name} اليوم الساعة {time} مع {staff_name}. حجزك: {link}"),
}


def variables(body):
    out = []
    for v in re.findall(r"\{(\w+)\}", body):
        if v not in out:
            out.append(v)
    return out


def check(t, body):
    assert not re.match(r'^\s*\{', body) and not re.search(r'\}\s*$', body), f'{t}: starts/ends with a variable'
    assert 'http' not in body, f'{t}: link in WhatsApp body'


q = lambda s: "'" + s.replace("'", "''") + "'"
arr = lambda xs: "'{" + ",".join('"' + x.replace('"', '\\"') + '"' for x in xs) + "}'"

rows = []
for t, (en, ar, buttons, sms, _customer) in T.items():
    for li, (loc, body) in enumerate((('en', en), ('ar', ar))):
        check(t, body)
        labels = [LABELS[b][li] for b in buttons]
        rows.append(f"  ({q(t)}, 'whatsapp', {q(loc)}, {q(t + '_v1')}, {q(body)}, {arr(variables(body))}, "
                    f"{arr(buttons)}, {arr(labels)}, 'draft', true)")
        if sms:
            sbody = SMS_OVERRIDE[t][li] if t in SMS_OVERRIDE else EMOJI.sub('', body).strip() + ' ' + SMS_LINK[sms][li]
            assert not EMOJI.search(sbody), f'{t}: emoji left in SMS'
            rows.append(f"  ({q(t)}, 'sms', {q(loc)}, null, {q(sbody)}, {arr(variables(sbody))}, "
                        "'{}', '{}', 'approved', true)")

sql = """-- M7 · Message templates (EN + AR) for WhatsApp and SMS — generated by
-- scripts/notification-templates.py (edit the script, not this file).
-- WhatsApp templates must be approved by Meta before they send: rows start as 'draft' with the
-- exact copy to submit ({name} placeholders become {{1}}, {{2}}… in `variables` order; buttons and
-- their labels as listed; URL buttons use a dynamic suffix — see docs/notifications/templates.md).
-- Until a locale is approved the English template is used; until English is approved, critical
-- booking messages go by SMS. Approving = set status 'approved' (ops, after Meta approval).

insert into public.notification_templates
  (type, channel, locale, provider_template_name, body, variables, buttons, button_labels, status, is_active)
values
""" + ",\n".join(rows) + ";\n"
(ROOT / 'supabase/migrations/20261003100100_m7_templates.sql').write_text(sql, encoding='utf-8', newline='\n')
print('templates written:', len(rows))
