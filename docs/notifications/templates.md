# Booking message copy (M7 + M9 reviews) — for review

Rendered with the real renderer and sample values: **Fade District**, Haircut with **Karim**,
**Tue 13 Oct at 4:30 PM** (moved from Mon 12 Oct at 6:00 PM), customer Moe.
Source of truth: `scripts/notification-templates.py` → `supabase/migrations/20261003100100_m7_templates.sql`
and (M9) `supabase/migrations/20261005100200_m9_review_templates.sql`.

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

## Booking confirmed `booking_confirmed`

**English — WhatsApp** (template `booking_confirmed_v1`, 5 parameters)

> ✅ You're booked at Fade District: Haircut with Karim, Tue 13 Oct at 4:30 PM. We'll send you a reminder before your visit.
>
> [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> You're booked at Fade District: Haircut with Karim, Tue 13 Oct at 4:30 PM. We'll send you a reminder before your visit. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `booking_confirmed_v1`, 5 parameters)

> ✅ تم تأكيد حجزك في Fade District: Haircut مع Karim، الثلاثاء، 13 تشرين الأول الساعة 4:30 م. سنرسل لك تذكيرًا قبل موعدك.
>
> [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> تم تأكيد حجزك في Fade District: Haircut مع Karim، الثلاثاء، 13 تشرين الأول الساعة 4:30 م. سنرسل لك تذكيرًا قبل موعدك. حجزك: https://platform.com/m/Xk3f9QpL2a

## Booking request received `booking_requested`

**English — WhatsApp** (template `booking_requested_v1`, 4 parameters)

> Thanks! Fade District received your request for Haircut on Tue 13 Oct at 4:30 PM. We'll let you know as soon as they reply.
>
> [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> Thanks! Fade District received your request for Haircut on Tue 13 Oct at 4:30 PM. We'll let you know as soon as they reply. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `booking_requested_v1`, 4 parameters)

> شكرًا! استلم Fade District طلبك لخدمة Haircut يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م. سنخبرك فور ردّهم.
>
> [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> شكرًا! استلم Fade District طلبك لخدمة Haircut يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م. سنخبرك فور ردّهم. حجزك: https://platform.com/m/Xk3f9QpL2a

## Request accepted `request_accepted`

**English — WhatsApp** (template `request_accepted_v1`, 5 parameters)

> ✅ Good news! Fade District confirmed your Haircut with Karim, Tue 13 Oct at 4:30 PM. See you then.
>
> [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> Good news! Fade District confirmed your Haircut with Karim, Tue 13 Oct at 4:30 PM. See you then. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `request_accepted_v1`, 5 parameters)

> ✅ خبر سار! أكّد Fade District موعد Haircut مع Karim، الثلاثاء، 13 تشرين الأول الساعة 4:30 م. نراك قريبًا.
>
> [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> خبر سار! أكّد Fade District موعد Haircut مع Karim، الثلاثاء، 13 تشرين الأول الساعة 4:30 م. نراك قريبًا. حجزك: https://platform.com/m/Xk3f9QpL2a

## Request declined `request_declined`

**English — WhatsApp** (template `request_declined_v1`, 4 parameters)

> Sorry, Fade District can't take your request for Tue 13 Oct at 4:30 PM. Reason: Karim is off sick. You can choose another time on their booking page.
>
> [ Book another time ↗ ](https://platform.com/{business slug})

**English — SMS**

> Sorry, Fade District can't take your request for Tue 13 Oct at 4:30 PM. Reason: Karim is off sick. You can choose another time on their booking page. Book again: https://platform.com/fade-district

**Arabic — WhatsApp** (template `request_declined_v1`, 4 parameters)

> نعتذر، لا يستطيع Fade District قبول طلبك ليوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م. السبب: كريم مريض. يمكنك اختيار وقت آخر من صفحة الحجز الخاصة بهم.
>
> [ احجز موعدًا آخر ↗ ](https://platform.com/{business slug})

**Arabic — SMS**

> نعتذر، لا يستطيع Fade District قبول طلبك ليوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م. السبب: كريم مريض. يمكنك اختيار وقت آخر من صفحة الحجز الخاصة بهم. احجز من جديد: https://platform.com/fade-district

## Request expired `request_expired`

**English — WhatsApp** (template `request_expired_v1`, 3 parameters)

> Sorry, Fade District didn't reply in time to your request for Tue 13 Oct at 4:30 PM. Your request expired. You can choose another time on their booking page.
>
> [ Book another time ↗ ](https://platform.com/{business slug})

**English — SMS**

> Sorry, Fade District didn't reply in time to your request for Tue 13 Oct at 4:30 PM. Your request expired. You can choose another time on their booking page. Book again: https://platform.com/fade-district

**Arabic — WhatsApp** (template `request_expired_v1`, 3 parameters)

> نعتذر، لم يردّ Fade District في الوقت المحدد على طلبك ليوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م. انتهت صلاحية طلبك. يمكنك اختيار وقت آخر من صفحة الحجز الخاصة بهم.
>
> [ احجز موعدًا آخر ↗ ](https://platform.com/{business slug})

**Arabic — SMS**

> نعتذر، لم يردّ Fade District في الوقت المحدد على طلبك ليوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م. انتهت صلاحية طلبك. يمكنك اختيار وقت آخر من صفحة الحجز الخاصة بهم. احجز من جديد: https://platform.com/fade-district

## 24-hour reminder `booking_reminder_24h`

**English — WhatsApp** (template `booking_reminder_24h_v1`, 5 parameters)

> ⏰ Reminder: Haircut at Fade District tomorrow, Tue 13 Oct at 4:30 PM, with Karim. Please tap Confirm if you're coming.
>
> [ Confirm ]  [ Change / Cancel ]  [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> Reminder: Haircut at Fade District tomorrow, Tue 13 Oct at 4:30 PM, with Karim. Confirm or change: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `booking_reminder_24h_v1`, 5 parameters)

> ⏰ تذكير: Haircut في Fade District غدًا، الثلاثاء، 13 تشرين الأول الساعة 4:30 م، مع Karim. اضغط «تأكيد» إذا كنت ستحضر.
>
> [ تأكيد ]  [ تعديل / إلغاء ]  [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> تذكير: Haircut في Fade District غدًا، الثلاثاء، 13 تشرين الأول الساعة 4:30 م، مع Karim. للتأكيد أو التعديل: https://platform.com/m/Xk3f9QpL2a

## 2-hour reminder `booking_reminder_2h`

**English — WhatsApp** (template `booking_reminder_2h_v1`, 4 parameters)

> See you soon! Haircut at Fade District today at 4:30 PM with Karim. Please confirm that you're still coming.
>
> [ Confirm ]  [ Change / Cancel ]  [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> See you soon! Haircut at Fade District today at 4:30 PM with Karim. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `booking_reminder_2h_v1`, 4 parameters)

> نراك قريبًا! Haircut في Fade District اليوم الساعة 4:30 م مع Karim. يرجى تأكيد أنك ما زلت قادمًا.
>
> [ تأكيد ]  [ تعديل / إلغاء ]  [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> نراك قريبًا! Haircut في Fade District اليوم الساعة 4:30 م مع Karim. حجزك: https://platform.com/m/Xk3f9QpL2a

## Rescheduled booking `booking_rescheduled_by_business`

**English — WhatsApp** (template `booking_rescheduled_by_business_v1`, 6 parameters)

> 📅 Your appointment at Fade District has moved. Haircut is now on Tue 13 Oct at 4:30 PM (it was Mon 12 Oct at 6:00 PM). If the new time doesn't suit you, you can change or cancel it from your booking.
>
> [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> Your appointment at Fade District has moved. Haircut is now on Tue 13 Oct at 4:30 PM (it was Mon 12 Oct at 6:00 PM). If the new time doesn't suit you, you can change or cancel it from your booking. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `booking_rescheduled_by_business_v1`, 6 parameters)

> 📅 تم تغيير موعدك في Fade District. أصبح موعد Haircut يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م (بدلًا من الاثنين، 12 تشرين الأول الساعة 6:00 م). إذا لم يناسبك الوقت الجديد، يمكنك تعديله أو إلغاؤه من صفحة الحجز.
>
> [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> تم تغيير موعدك في Fade District. أصبح موعد Haircut يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م (بدلًا من الاثنين، 12 تشرين الأول الساعة 6:00 م). إذا لم يناسبك الوقت الجديد، يمكنك تعديله أو إلغاؤه من صفحة الحجز. حجزك: https://platform.com/m/Xk3f9QpL2a

## Staff changed `staff_changed`

**English — WhatsApp** (template `staff_changed_v1`, 5 parameters)

> Update from Fade District: your Haircut on Tue 13 Oct at 4:30 PM will now be with Karim. If you'd rather change it, you can do so from your booking.
>
> [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> Update from Fade District: your Haircut on Tue 13 Oct at 4:30 PM will now be with Karim. If you'd rather change it, you can do so from your booking. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `staff_changed_v1`, 5 parameters)

> تحديث من Fade District: موعد Haircut يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م سيكون الآن مع Karim. إذا أردت تغييره، يمكنك ذلك من صفحة الحجز.
>
> [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> تحديث من Fade District: موعد Haircut يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م سيكون الآن مع Karim. إذا أردت تغييره، يمكنك ذلك من صفحة الحجز. حجزك: https://platform.com/m/Xk3f9QpL2a

## Business cancellation `booking_cancelled_by_business`

**English — WhatsApp** (template `booking_cancelled_by_business_v1`, 5 parameters)

> Sorry, Fade District had to cancel your Haircut on Tue 13 Oct at 4:30 PM. Reason: Karim is off sick. You can book another time on their booking page.
>
> [ Book another time ↗ ](https://platform.com/{business slug})

**English — SMS**

> Sorry, Fade District had to cancel your Haircut on Tue 13 Oct at 4:30 PM. Reason: Karim is off sick. You can book another time on their booking page. Book again: https://platform.com/fade-district

**Arabic — WhatsApp** (template `booking_cancelled_by_business_v1`, 5 parameters)

> نعتذر، اضطر Fade District إلى إلغاء موعد Haircut يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م. السبب: كريم مريض. يمكنك حجز وقت آخر من صفحة الحجز الخاصة بهم.
>
> [ احجز موعدًا آخر ↗ ](https://platform.com/{business slug})

**Arabic — SMS**

> نعتذر، اضطر Fade District إلى إلغاء موعد Haircut يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م. السبب: كريم مريض. يمكنك حجز وقت آخر من صفحة الحجز الخاصة بهم. احجز من جديد: https://platform.com/fade-district

## Customer cancellation acknowledgement `booking_cancelled_by_customer`

**English — WhatsApp** (template `booking_cancelled_by_customer_v1`, 4 parameters)

> Your Haircut booking at Fade District on Tue 13 Oct at 4:30 PM has been cancelled.
>
> [ Book another time ↗ ](https://platform.com/{business slug})

**English — SMS**

> Your Haircut booking at Fade District on Tue 13 Oct at 4:30 PM has been cancelled. Book again: https://platform.com/fade-district

**Arabic — WhatsApp** (template `booking_cancelled_by_customer_v1`, 4 parameters)

> تم إلغاء حجز Haircut في Fade District يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م.
>
> [ احجز موعدًا آخر ↗ ](https://platform.com/{business slug})

**Arabic — SMS**

> تم إلغاء حجز Haircut في Fade District يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م. احجز من جديد: https://platform.com/fade-district

## No-show `booking_no_show_marked`

**English — WhatsApp** (template `booking_no_show_marked_v1`, 4 parameters)

> Hi, Fade District recorded that you missed your Haircut on Tue 13 Oct at 4:30 PM. If this is a mistake, open your booking to let us know.
>
> [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> Hi, Fade District recorded that you missed your Haircut on Tue 13 Oct at 4:30 PM. If this is a mistake, open your booking to let us know. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `booking_no_show_marked_v1`, 4 parameters)

> مرحبًا، سجّل Fade District أنك لم تحضر موعد Haircut يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م. إذا كان ذلك خطأ، افتح صفحة الحجز لإبلاغنا.
>
> [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> مرحبًا، سجّل Fade District أنك لم تحضر موعد Haircut يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م. إذا كان ذلك خطأ، افتح صفحة الحجز لإبلاغنا. حجزك: https://platform.com/m/Xk3f9QpL2a

## Team alert: new online booking `biz_new_booking`

**English — WhatsApp** (template `biz_new_booking_v1`, 5 parameters)

> 📅 New booking: Moe, Haircut with Karim, Tue 13 Oct at 4:30 PM.
>
> [ Open bookings ↗ ](https://platform.com/biz/{business}/bookings)

**Arabic — WhatsApp** (template `biz_new_booking_v1`, 5 parameters)

> 📅 حجز جديد: Moe، Haircut مع Karim، الثلاثاء، 13 تشرين الأول الساعة 4:30 م.
>
> [ فتح الحجوزات ↗ ](https://platform.com/biz/{business}/bookings)

## Team alert: new request `biz_new_request`

**English — WhatsApp** (template `biz_new_request_v1`, 4 parameters)

> ⏳ New request waiting for your answer: Moe, Haircut, Tue 13 Oct at 4:30 PM. Accept or decline it in your bookings.
>
> [ Open bookings ↗ ](https://platform.com/biz/{business}/bookings)

**Arabic — WhatsApp** (template `biz_new_request_v1`, 4 parameters)

> ⏳ طلب جديد بانتظار ردّك: Moe، Haircut، الثلاثاء، 13 تشرين الأول الساعة 4:30 م. اقبله أو ارفضه من صفحة الحجوزات.
>
> [ فتح الحجوزات ↗ ](https://platform.com/biz/{business}/bookings)

## Team alert: customer cancelled `biz_booking_cancelled`

**English — WhatsApp** (template `biz_booking_cancelled_v1`, 5 parameters)

> ❌ Cancelled by the customer: Moe, Haircut with Karim, Tue 13 Oct at 4:30 PM. The time is free again.
>
> [ Open bookings ↗ ](https://platform.com/biz/{business}/bookings)

**Arabic — WhatsApp** (template `biz_booking_cancelled_v1`, 5 parameters)

> ❌ ألغى الزبون: Moe، Haircut مع Karim، الثلاثاء، 13 تشرين الأول الساعة 4:30 م. أصبح الوقت متاحًا من جديد.
>
> [ فتح الحجوزات ↗ ](https://platform.com/biz/{business}/bookings)

## Review request (M9) `review_request`

**English — WhatsApp** (template `review_request_v1`, 2 parameters)

> How was your Haircut at Fade District? Leave a quick review, it helps others choose.
>
> [ Leave a review ↗ ](https://platform.com/review/{token})

**English — SMS**

> How was your Haircut at Fade District? Leave a quick review, it helps others choose. Review: https://platform.com/review/Rv7Tq2mZ9w

**Arabic — WhatsApp** (template `review_request_v1`, 2 parameters)

> كيف كانت تجربتك مع Haircut في Fade District؟ اترك تقييمًا سريعًا، فهو يساعد الآخرين على الاختيار.
>
> [ اترك تقييمًا ↗ ](https://platform.com/review/{token})

**Arabic — SMS**

> كيف كانت تجربتك مع Haircut في Fade District؟ اترك تقييمًا سريعًا، فهو يساعد الآخرين على الاختيار. للتقييم: https://platform.com/review/Rv7Tq2mZ9w

## Review comment needs changes (M9) `review_needs_changes`

**English — WhatsApp** (template `review_needs_changes_v1`, 1 parameters)

> Your rating for Fade District is live, but your comment couldn't be published as written. You can edit it within 7 days.
>
> [ Edit my review ↗ ](https://platform.com/review/{token})

**English — SMS**

> Your rating for Fade District is live, but your comment couldn't be published as written. You can edit it within 7 days. Edit: https://platform.com/review/Rv7Tq2mZ9w

**Arabic — WhatsApp** (template `review_needs_changes_v1`, 1 parameters)

> تقييمك لـ Fade District منشور، لكن تعليقك لم يُنشر بصيغته الحالية. يمكنك تعديله خلال 7 أيام.
>
> [ تعديل تقييمي ↗ ](https://platform.com/review/{token})

**Arabic — SMS**

> تقييمك لـ Fade District منشور، لكن تعليقك لم يُنشر بصيغته الحالية. يمكنك تعديله خلال 7 أيام. للتعديل: https://platform.com/review/Rv7Tq2mZ9w

## Team alert: new review (M9, owners/managers) `biz_new_review`

**English — WhatsApp** (template `biz_new_review_v1`, 3 parameters)

> ⭐ New 2-star review for Haircut with Karim. Reply from your dashboard.
>
> [ Open reviews ↗ ](https://platform.com/biz/{business}/reviews)

**Arabic — WhatsApp** (template `biz_new_review_v1`, 3 parameters)

> ⭐ تقييم جديد بـ 2 من 5 نجوم لـ Haircut مع Karim. يمكنك الرد من لوحة التحكم.
>
> [ فتح التقييمات ↗ ](https://platform.com/biz/{business}/reviews)

## Replies to button taps (sent in the customer's open WhatsApp session)

**After Confirm**

> Thanks! You're confirmed for Haircut at Fade District on Tue 13 Oct at 4:30 PM.

> شكرًا! تم تأكيد حضورك لـ Haircut في Fade District يوم الثلاثاء، 13 تشرين الأول الساعة 4:30 م.


**After Change / Cancel**

> To change or cancel your booking, open your booking page: https://platform.com/m/Xk3f9QpL2a (the cancellation policy is shown there before you confirm).

> لتعديل الحجز أو إلغائه، افتح صفحة الحجز: https://platform.com/m/Xk3f9QpL2a (تظهر سياسة الإلغاء هناك قبل التأكيد).


**Confirm on a booking that can no longer be confirmed**

> This booking can't be confirmed anymore. Details: https://platform.com/m/Xk3f9QpL2a

> لم يعد بالإمكان تأكيد هذا الحجز. التفاصيل: https://platform.com/m/Xk3f9QpL2a


**Tap from a different number**

> We couldn't match this booking to your number.

> لم نتمكن من ربط هذا الحجز برقمك.

