# Booking message copy (M7) — for review

Rendered with the real renderer and sample values: **Fade District**, Haircut with **Karim**,
**Tue 13 Oct at 4:30 PM** (moved from Mon 12 Oct at 6:00 PM), customer Moe.
Source of truth: `scripts/notification-templates.py` → `supabase/migrations/20261003100100_m7_templates.sql`.

- **WhatsApp**: body text + buttons. Links are buttons (Meta doesn't allow links or variables at the
  start/end of a template body). *Confirm* / *Cancel* are quick replies: Confirm confirms attendance
  (only from the customer's number); Cancel replies with the booking link (never cancels directly).
- **SMS** (backup for booking messages): same text without emoji, with the link written out.
- Empty reason → "We're sorry for the inconvenience." / "نعتذر عن الإزعاج."
- There is **no customer-cancellation acknowledgement** message today: the customer sees the
  confirmation on screen (booking page, M8) and the team gets an alert.

## Booking confirmed `booking_confirmed`

**English — WhatsApp** (template `booking_confirmed_v1`, 5 parameters)

> ✅ You're booked at Fade District: Haircut with Karim, Tue 13 Oct at 4:30 PM. We'll send you a reminder before your visit.
>
> [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> You're booked at Fade District: Haircut with Karim, Tue 13 Oct at 4:30 PM. We'll send you a reminder before your visit. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `booking_confirmed_v1`, 5 parameters)

> ✅ تم تأكيد حجزك في Fade District: Haircut مع Karim، الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. سنرسل لك تذكيرًا قبل موعدك.
>
> [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> تم تأكيد حجزك في Fade District: Haircut مع Karim، الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. سنرسل لك تذكيرًا قبل موعدك. حجزك: https://platform.com/m/Xk3f9QpL2a

## Booking request received `booking_requested`

**English — WhatsApp** (template `booking_requested_v1`, 4 parameters)

> Thanks! Fade District received your request for Haircut on Tue 13 Oct at 4:30 PM. We'll let you know as soon as they reply.
>
> [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> Thanks! Fade District received your request for Haircut on Tue 13 Oct at 4:30 PM. We'll let you know as soon as they reply. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `booking_requested_v1`, 4 parameters)

> شكرًا! استلم Fade District طلبك لخدمة Haircut يوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. سنخبرك فور ردّهم.
>
> [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> شكرًا! استلم Fade District طلبك لخدمة Haircut يوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. سنخبرك فور ردّهم. حجزك: https://platform.com/m/Xk3f9QpL2a

## Request accepted `request_accepted`

**English — WhatsApp** (template `request_accepted_v1`, 5 parameters)

> ✅ Good news! Fade District confirmed your Haircut with Karim, Tue 13 Oct at 4:30 PM. See you then.
>
> [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> Good news! Fade District confirmed your Haircut with Karim, Tue 13 Oct at 4:30 PM. See you then. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `request_accepted_v1`, 5 parameters)

> ✅ خبر سار! أكّد Fade District موعد Haircut مع Karim، الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. نراك قريبًا.
>
> [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> خبر سار! أكّد Fade District موعد Haircut مع Karim، الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. نراك قريبًا. حجزك: https://platform.com/m/Xk3f9QpL2a

## Request declined `request_declined`

**English — WhatsApp** (template `request_declined_v1`, 4 parameters)

> Sorry, Fade District can't take your request for Tue 13 Oct at 4:30 PM. Reason: Karim is off sick. You can choose another time on their booking page.
>
> [ Book another time ↗ ](https://platform.com/{business slug})

**English — SMS**

> Sorry, Fade District can't take your request for Tue 13 Oct at 4:30 PM. Reason: Karim is off sick. You can choose another time on their booking page. Book again: https://platform.com/fade-district

**Arabic — WhatsApp** (template `request_declined_v1`, 4 parameters)

> نعتذر، لا يستطيع Fade District قبول طلبك ليوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. السبب: كريم مريض. يمكنك اختيار وقت آخر من صفحة الحجز الخاصة بهم.
>
> [ احجز موعدًا آخر ↗ ](https://platform.com/{business slug})

**Arabic — SMS**

> نعتذر، لا يستطيع Fade District قبول طلبك ليوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. السبب: كريم مريض. يمكنك اختيار وقت آخر من صفحة الحجز الخاصة بهم. احجز من جديد: https://platform.com/fade-district

## Request expired `request_expired`

**English — WhatsApp** (template `request_expired_v1`, 3 parameters)

> Sorry, Fade District didn't reply in time to your request for Tue 13 Oct at 4:30 PM, so it was cancelled. You can choose another time on their booking page.
>
> [ Book another time ↗ ](https://platform.com/{business slug})

**English — SMS**

> Sorry, Fade District didn't reply in time to your request for Tue 13 Oct at 4:30 PM, so it was cancelled. You can choose another time on their booking page. Book again: https://platform.com/fade-district

**Arabic — WhatsApp** (template `request_expired_v1`, 3 parameters)

> نعتذر، لم يردّ Fade District على طلبك ليوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م في الوقت المحدد، فتم إلغاؤه. يمكنك اختيار وقت آخر من صفحة الحجز الخاصة بهم.
>
> [ احجز موعدًا آخر ↗ ](https://platform.com/{business slug})

**Arabic — SMS**

> نعتذر، لم يردّ Fade District على طلبك ليوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م في الوقت المحدد، فتم إلغاؤه. يمكنك اختيار وقت آخر من صفحة الحجز الخاصة بهم. احجز من جديد: https://platform.com/fade-district

## 24-hour reminder `booking_reminder_24h`

**English — WhatsApp** (template `booking_reminder_24h_v1`, 5 parameters)

> ⏰ Reminder: Haircut at Fade District tomorrow, Tue 13 Oct at 4:30 PM, with Karim. Please tap Confirm if you're coming.
>
> [ Confirm ]  [ Cancel ]  [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> Reminder: Haircut at Fade District tomorrow, Tue 13 Oct at 4:30 PM, with Karim. Confirm or change: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `booking_reminder_24h_v1`, 5 parameters)

> ⏰ تذكير: Haircut في Fade District غدًا، الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م، مع Karim. اضغط «تأكيد» إذا كنت ستحضر.
>
> [ تأكيد ]  [ إلغاء ]  [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> تذكير: Haircut في Fade District غدًا، الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م، مع Karim. للتأكيد أو التعديل: https://platform.com/m/Xk3f9QpL2a

## 2-hour reminder `booking_reminder_2h`

**English — WhatsApp** (template `booking_reminder_2h_v1`, 4 parameters)

> See you soon! Haircut at Fade District today at 4:30 PM with Karim. Tap Confirm to let them know you're on your way.
>
> [ Confirm ]  [ Cancel ]  [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> See you soon! Haircut at Fade District today at 4:30 PM with Karim. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `booking_reminder_2h_v1`, 4 parameters)

> نراك قريبًا! Haircut في Fade District اليوم الساعة ٤:٣٠ م مع Karim. اضغط «تأكيد» ليعرفوا أنك في الطريق.
>
> [ تأكيد ]  [ إلغاء ]  [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> نراك قريبًا! Haircut في Fade District اليوم الساعة ٤:٣٠ م مع Karim. حجزك: https://platform.com/m/Xk3f9QpL2a

## Rescheduled booking `booking_rescheduled_by_business`

**English — WhatsApp** (template `booking_rescheduled_by_business_v1`, 6 parameters)

> 📅 Your appointment at Fade District has moved. Haircut is now on Tue 13 Oct at 4:30 PM (it was Mon 12 Oct at 6:00 PM). If the new time doesn't suit you, you can change or cancel it from your booking.
>
> [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> Your appointment at Fade District has moved. Haircut is now on Tue 13 Oct at 4:30 PM (it was Mon 12 Oct at 6:00 PM). If the new time doesn't suit you, you can change or cancel it from your booking. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `booking_rescheduled_by_business_v1`, 6 parameters)

> 📅 تم تغيير موعدك في Fade District. أصبح موعد Haircut يوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م (بدلًا من الاثنين، ١٢ تشرين الأول الساعة ٦:٠٠ م). إذا لم يناسبك الوقت الجديد، يمكنك تعديله أو إلغاؤه من صفحة الحجز.
>
> [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> تم تغيير موعدك في Fade District. أصبح موعد Haircut يوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م (بدلًا من الاثنين، ١٢ تشرين الأول الساعة ٦:٠٠ م). إذا لم يناسبك الوقت الجديد، يمكنك تعديله أو إلغاؤه من صفحة الحجز. حجزك: https://platform.com/m/Xk3f9QpL2a

## Staff changed `staff_changed`

**English — WhatsApp** (template `staff_changed_v1`, 5 parameters)

> Update from Fade District: your Haircut on Tue 13 Oct at 4:30 PM will now be with Karim. If you'd rather change it, you can do so from your booking.
>
> [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> Update from Fade District: your Haircut on Tue 13 Oct at 4:30 PM will now be with Karim. If you'd rather change it, you can do so from your booking. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `staff_changed_v1`, 5 parameters)

> تحديث من Fade District: موعد Haircut يوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م سيكون الآن مع Karim. إذا أردت تغييره، يمكنك ذلك من صفحة الحجز.
>
> [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> تحديث من Fade District: موعد Haircut يوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م سيكون الآن مع Karim. إذا أردت تغييره، يمكنك ذلك من صفحة الحجز. حجزك: https://platform.com/m/Xk3f9QpL2a

## Business cancellation `booking_cancelled_by_business`

**English — WhatsApp** (template `booking_cancelled_by_business_v1`, 5 parameters)

> Sorry, Fade District had to cancel your Haircut on Tue 13 Oct at 4:30 PM. Reason: Karim is off sick. You can book another time on their booking page.
>
> [ Book another time ↗ ](https://platform.com/{business slug})

**English — SMS**

> Sorry, Fade District had to cancel your Haircut on Tue 13 Oct at 4:30 PM. Reason: Karim is off sick. You can book another time on their booking page. Book again: https://platform.com/fade-district

**Arabic — WhatsApp** (template `booking_cancelled_by_business_v1`, 5 parameters)

> نعتذر، اضطر Fade District إلى إلغاء موعد Haircut يوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. السبب: كريم مريض. يمكنك حجز وقت آخر من صفحة الحجز الخاصة بهم.
>
> [ احجز موعدًا آخر ↗ ](https://platform.com/{business slug})

**Arabic — SMS**

> نعتذر، اضطر Fade District إلى إلغاء موعد Haircut يوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. السبب: كريم مريض. يمكنك حجز وقت آخر من صفحة الحجز الخاصة بهم. احجز من جديد: https://platform.com/fade-district

## No-show `booking_no_show_marked`

**English — WhatsApp** (template `booking_no_show_marked_v1`, 4 parameters)

> Hi, Fade District recorded that you missed your Haircut on Tue 13 Oct at 4:30 PM. If this is a mistake, open your booking to let us know.
>
> [ View booking ↗ ](https://platform.com/m/{token})

**English — SMS**

> Hi, Fade District recorded that you missed your Haircut on Tue 13 Oct at 4:30 PM. If this is a mistake, open your booking to let us know. Your booking: https://platform.com/m/Xk3f9QpL2a

**Arabic — WhatsApp** (template `booking_no_show_marked_v1`, 4 parameters)

> مرحبًا، سجّل Fade District أنك لم تحضر موعد Haircut يوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. إذا كان ذلك خطأ، افتح صفحة الحجز لإبلاغنا.
>
> [ عرض الحجز ↗ ](https://platform.com/m/{token})

**Arabic — SMS**

> مرحبًا، سجّل Fade District أنك لم تحضر موعد Haircut يوم الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. إذا كان ذلك خطأ، افتح صفحة الحجز لإبلاغنا. حجزك: https://platform.com/m/Xk3f9QpL2a

## Team alert: new online booking `biz_new_booking`

**English — WhatsApp** (template `biz_new_booking_v1`, 5 parameters)

> 📅 New booking: Moe, Haircut with Karim, Tue 13 Oct at 4:30 PM.
>
> [ Open bookings ↗ ](https://platform.com/biz/{business}/bookings)

**Arabic — WhatsApp** (template `biz_new_booking_v1`, 5 parameters)

> 📅 حجز جديد: Moe، Haircut مع Karim، الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م.
>
> [ فتح الحجوزات ↗ ](https://platform.com/biz/{business}/bookings)

## Team alert: new request `biz_new_request`

**English — WhatsApp** (template `biz_new_request_v1`, 4 parameters)

> ⏳ New request waiting for your answer: Moe, Haircut, Tue 13 Oct at 4:30 PM. Accept or decline it in your bookings.
>
> [ Open bookings ↗ ](https://platform.com/biz/{business}/bookings)

**Arabic — WhatsApp** (template `biz_new_request_v1`, 4 parameters)

> ⏳ طلب جديد بانتظار ردّك: Moe، Haircut، الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. اقبله أو ارفضه من صفحة الحجوزات.
>
> [ فتح الحجوزات ↗ ](https://platform.com/biz/{business}/bookings)

## Team alert: customer cancelled `biz_booking_cancelled`

**English — WhatsApp** (template `biz_booking_cancelled_v1`, 5 parameters)

> ❌ Cancelled by the customer: Moe, Haircut with Karim, Tue 13 Oct at 4:30 PM. The time is free again.
>
> [ Open bookings ↗ ](https://platform.com/biz/{business}/bookings)

**Arabic — WhatsApp** (template `biz_booking_cancelled_v1`, 5 parameters)

> ❌ ألغى الزبون: Moe، Haircut مع Karim، الثلاثاء، ١٣ تشرين الأول الساعة ٤:٣٠ م. أصبح الوقت متاحًا من جديد.
>
> [ فتح الحجوزات ↗ ](https://platform.com/biz/{business}/bookings)
