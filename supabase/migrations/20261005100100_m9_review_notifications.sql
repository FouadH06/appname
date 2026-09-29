-- M9 · Review notifications: review request 2 h after the visit (outside quiet hours), "your comment
--      needs changes", and the team's new-review alert (owners/managers: a management alert).

insert into private.notification_routes (type, primary_channels, fallback_channels, critical) values
  ('review_request', '{whatsapp}', '{}', false),
  ('review_needs_changes', '{whatsapp}', '{}', false),
  ('biz_new_review', '{whatsapp}', '{}', false);

-- Link for the review page: a review token for the customer's account, or a claim link for a visit
-- a business logged for a customer without an account (they verify their phone, claim, then review).
create function private.review_link_payload(p_booking_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings; v_token text; v_base text := private.app_setting('web_base_url');
begin
  select * into b from public.bookings where id = p_booking_id;
  begin
    v_token := private.issue_access_token(
      case when b.customer_user_id is null and b.source in ('manual', 'walk_in') then 'claim_visit' else 'review' end, b.id);
  exception when sqlstate 'P0001' then
    return '{}'::jsonb;
  end;
  return jsonb_build_object('review_token', v_token, 'review_link', v_base || '/review/' || v_token);
end $$;

create function private.schedule_review_request(p_booking_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings; v_at timestamptz; v_extra jsonb;
begin
  select * into b from public.bookings where id = p_booking_id;
  if b.status <> 'completed' then return; end if;
  v_at := greatest(now(), b.ends_at + interval '2 hours');
  if coalesce(private.in_quiet_hours(b.business_id, v_at), false) then
    v_at := private.quiet_hours_end_after(b.business_id, v_at);
  end if;
  v_extra := private.review_link_payload(p_booking_id);
  if v_extra = '{}'::jsonb then return; end if;
  perform private.notify_customer('review_request', p_booking_id, v_extra, 'review_request:' || p_booking_id, v_at);
end $$;

-- New optional payload (e.g. the star rating for the new-review alert). Dropped and recreated so
-- existing two-argument calls resolve to this one (a second overload would make them ambiguous).
drop function private.notify_business(public.notification_type, uuid);
create function private.notify_business(p_type public.notification_type, p_booking_id uuid, p_extra jsonb default '{}')
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings; r record; v_payload jsonb; v_custom boolean; v_at timestamptz;
begin
  select * into b from public.bookings where id = p_booking_id;
  select exists (select 1 from public.business_notification_settings where business_id = b.business_id and type = p_type)
    into v_custom;
  v_payload := (private.booking_payload(p_booking_id) - 'link' - 'link_token') || coalesce(p_extra, '{}');
  v_at := private.business_alert_at(b.business_id, b.starts_at, b.expires_at);
  for r in
    select m.user_id, p.phone_e164, p.locale
    from public.business_members m join public.profiles p on p.id = m.user_id
    where m.business_id = b.business_id and m.status = 'active' and p.status <> 'deleted'
      and case when v_custom
               then exists (select 1 from public.business_notification_settings s
                            where s.business_id = b.business_id and s.user_id = m.user_id and s.type = p_type
                              and 'whatsapp' = any(s.channels))
               -- reception gets the operational alerts; management alerts (e.g. new review) stay owner/manager
               else m.role in ('owner', 'manager')
                    or (m.role = 'reception' and p_type in ('biz_new_booking', 'biz_new_request', 'biz_booking_cancelled')) end
  loop
    perform private.enqueue_notification(p_type, p_booking_id, r.user_id, r.phone_e164, b.business_id, v_payload, r.locale,
                                         p_type || ':' || p_booking_id || ':' || r.user_id, v_at);
  end loop;
end $$;

create or replace function private.on_booking_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_notify boolean := coalesce((new.data ->> 'notify')::boolean, false);
  v_undo boolean := coalesce((new.data ->> 'undo')::boolean, false);
  v_id uuid := new.booking_id; v_e text := new.event::text; v_key text := new.event::text || ':' || new.booking_id || ':' || new.id;
begin
  if new.event = 'confirmed' then
    if new.actor_kind = 'customer' then
      perform private.notify_customer('booking_confirmed', v_id, '{}', v_key);
      perform private.notify_business('biz_new_booking', v_id);
      perform private.schedule_reminders(v_id);
    elsif v_notify then                                            -- manual booking with "Send confirmation" on
      perform private.notify_customer('booking_confirmed', v_id, '{}', v_key);
      perform private.schedule_reminders(v_id);
    end if;
  elsif new.event = 'requested' then
    perform private.notify_customer('booking_requested', v_id, '{}', v_key);
    perform private.notify_business('biz_new_request', v_id);
  elsif new.event = 'accepted' then
    perform private.notify_customer('request_accepted', v_id, '{}', v_key);
    perform private.schedule_reminders(v_id);
  elsif new.event = 'declined' then
    perform private.notify_customer('request_declined', v_id, jsonb_build_object('reason', new.data ->> 'reason'), v_key);
  elsif new.event = 'expired' then
    perform private.notify_customer('request_expired', v_id, '{}', v_key);
  elsif new.event = 'cancelled' then
    perform private.cancel_reminders(v_id);
    if new.actor_kind = 'customer' then
      perform private.notify_business('biz_booking_cancelled', v_id);
      -- acknowledgement (the event is written in the same transaction as the cancellation, so it
      -- only exists if the cancellation succeeded); not for account deletions
      if coalesce(new.data ->> 'reason', '') <> 'account_deleted' then
        perform private.notify_customer('booking_cancelled_by_customer', v_id, '{}', v_key);
      end if;
    elsif v_notify and not v_undo then
      perform private.notify_customer('booking_cancelled_by_business', v_id,
                                      jsonb_build_object('reason', new.data ->> 'reason'), v_key);
    end if;
  elsif new.event = 'rescheduled' then
    perform private.schedule_reminders(v_id);                      -- cancels the old ones, schedules new
    if new.actor_kind <> 'customer' and v_notify then
      perform private.notify_customer('booking_rescheduled_by_business', v_id,
                                      jsonb_build_object('old_starts_at', new.data ->> 'old_start'), v_key);
    end if;
  elsif new.event = 'staff_changed' and v_notify then
    perform private.notify_customer('staff_changed', v_id, '{}', v_key);
  elsif new.event = 'no_show_marked' then
    perform private.cancel_reminders(v_id);
    perform private.notify_customer('booking_no_show_marked', v_id, '{}', v_key);
  elsif new.event = 'completed' then
    perform private.cancel_reminders(v_id);
    perform private.schedule_review_request(v_id);
  end if;
  return null;
end $$;

select private.assign_app_ownership();
