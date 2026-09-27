-- M1 · All enums (copied verbatim from Phase 3 Part 1 §5 — keep in sync with the spec)

-- Identity & roles
create type public.user_status         as enum ('active', 'warned', 'suspended', 'deleted');
create type public.app_locale          as enum ('en', 'ar', 'fr');
create type public.business_role       as enum ('owner', 'manager', 'reception', 'staff');
create type public.member_status       as enum ('invited', 'active', 'revoked');
create type public.admin_role          as enum ('moderator', 'support', 'ops', 'superadmin');

-- Business & catalog
create type public.business_status     as enum ('draft', 'live', 'paused', 'suspended', 'closed');
create type public.location_status     as enum ('draft', 'live', 'paused', 'closed');
create type public.verification_status as enum ('unverified', 'pending', 'verified', 'rejected');
create type public.audience            as enum ('women', 'men', 'everyone');
create type public.area_level          as enum ('governorate', 'district', 'area');
create type public.synonym_lang        as enum ('en', 'ar', 'fr', 'arabizi');
create type public.price_type          as enum ('fixed', 'from', 'range', 'on_consultation');
create type public.service_location_type as enum ('at_business', 'at_customer', 'both');
create type public.lifecycle_status    as enum ('active', 'archived');
create type public.booking_mode        as enum ('instant', 'request');

-- Staff
create type public.staff_choice_mode   as enum ('any_or_choose', 'any_only', 'choose_only');
create type public.assignment_rule     as enum ('least_booked', 'priority', 'round_robin', 'minimize_gaps');
create type public.staff_selection_mode as enum ('any', 'specific', 'rebook', 'business');
create type public.time_off_kind       as enum ('vacation', 'sick', 'personal', 'training', 'other');

-- Customers
create type public.acquisition_channel as enum ('marketplace', 'business_link', 'manual', 'import');
create type public.reliability_tier    as enum ('new', 'reliable', 'some_missed', 'restricted', 'blocked');
create type public.reliability_label   as enum ('new_customer', 'reliable', 'some_missed_appointments');

-- Booking
create type public.booking_status      as enum ('held', 'pending', 'confirmed', 'completed', 'cancelled', 'no_show');
create type public.booking_source      as enum ('marketplace_search', 'marketplace_home', 'marketplace_other',
                                                'business_link', 'rebook', 'waitlist', 'promotion', 'manual', 'walk_in');
create type public.actor_kind          as enum ('customer', 'business', 'admin', 'system');
create type public.booking_event_type  as enum ('held', 'confirmed', 'requested', 'accepted', 'declined', 'expired',
                                                'rescheduled', 'staff_changed', 'cancelled', 'completed', 'no_show_marked',
                                                'no_show_contested', 'no_show_resolved', 'note_changed', 'price_changed',
                                                'reminder_sent', 'customer_confirmed', 'claimed');
create type public.payment_status      as enum ('not_required', 'pending', 'paid', 'refunded', 'failed');
create type public.waitlist_status     as enum ('active', 'offered', 'booked', 'expired', 'cancelled');
create type public.offer_status        as enum ('sent', 'claimed', 'expired', 'superseded');

-- Trust
create type public.trust_tier          as enum ('verified_booking', 'verified_visit');
create type public.review_status       as enum ('pending', 'published', 'removed', 'deleted_by_author');
create type public.content_state       as enum ('pending', 'approved', 'approved_redacted', 'manual_review', 'rejected', 'removed');
create type public.rating_state        as enum ('pending_check', 'active', 'quarantined', 'removed');
create type public.media_kind          as enum ('result', 'before', 'after');
create type public.business_media_kind as enum ('cover', 'portfolio', 'logo', 'staff_photo');
create type public.media_status        as enum ('uploaded', 'processing', 'approved', 'manual_review', 'rejected', 'removed', 'deleted');
create type public.moderation_subject  as enum ('review_text', 'reply_text', 'review_media', 'business_media', 'staff_bio', 'business_text');
create type public.moderation_stage    as enum ('validation', 'sanitize', 'hash', 'safety', 'ocr', 'relevance',
                                                'text_rules', 'text_normalize', 'text_llm', 'decision');
create type public.case_state          as enum ('open', 'claimed', 'decided', 'escalated');
create type public.moderation_decision as enum ('approve', 'approve_redacted', 'reject', 'remove_media', 'remove_text',
                                                'remove_review', 'escalate');
create type public.report_subject      as enum ('review', 'review_media', 'review_reply', 'business', 'staff', 'user');
create type public.report_reason       as enum ('never_attended', 'abusive_language', 'personal_information', 'unrelated_image',
                                                'spam', 'fake_review', 'false_information', 'inappropriate', 'harassment',
                                                'my_photo', 'other');
create type public.report_status       as enum ('open', 'in_review', 'resolved_action', 'resolved_no_action', 'rejected');
create type public.dispute_type        as enum ('no_show', 'review_attendance', 'legal', 'ownership');
create type public.dispute_status      as enum ('open', 'awaiting_info', 'resolved', 'void');
create type public.dispute_outcome     as enum ('no_show_upheld', 'no_show_overturned', 'voided', 'review_kept',
                                                'review_text_removed', 'review_media_removed', 'review_removed',
                                                'legal_kept', 'legal_removed', 'ownership_transferred', 'ownership_denied');
create type public.fraud_signal_type   as enum ('new_account_review', 'device_cluster', 'ip_cluster', 'review_burst',
                                                'member_self_review', 'duplicate_text', 'visit_tier_cap', 'no_show_pattern',
                                                'report_abuse', 'phone_cluster');

-- Discovery
create type public.config_status       as enum ('draft', 'active', 'archived');
create type public.discovery_label     as enum ('top_rated', 'top_cleanliness', 'great_punctuality', 'popular_near_you',
                                                'available_today', 'best_value', 'new');

-- Notifications
create type public.notification_channel as enum ('push', 'whatsapp', 'sms', 'email', 'in_app');
create type public.notification_status  as enum ('queued', 'processing', 'sent', 'partially_failed', 'failed', 'cancelled');
create type public.delivery_status      as enum ('queued', 'sent', 'delivered', 'read', 'failed');
create type public.notification_type    as enum (
  -- customer
  'booking_confirmed', 'booking_requested', 'request_accepted', 'request_declined', 'request_expired',
  'booking_reminder_24h', 'booking_reminder_2h', 'booking_cancelled_by_business', 'booking_rescheduled_by_business',
  'staff_changed', 'booking_no_show_marked', 'review_request', 'review_published', 'review_needs_changes', 'result_published', 'result_rejected',
  'waitlist_offer', 'dispute_update', 'otp',
  -- business
  'biz_new_booking', 'biz_new_request', 'biz_booking_cancelled', 'biz_new_review', 'biz_report_resolved',
  'biz_waitlist_claimed', 'biz_schedule_conflict', 'biz_invite', 'biz_daily_summary');

-- Billing placeholders
create type public.subscription_status as enum ('free_launch', 'trialing', 'active', 'past_due', 'cancelled');

select private.assign_app_ownership();
