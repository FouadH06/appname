-- M7 · Notifications & WhatsApp: outbox, deliveries, templates (EN + AR), routing, preferences,
--      business alert settings, push tokens, WhatsApp inbound (Confirm / Cancel buttons)
-- Spec: Phase 3 Part 5 §6, Part 3 §4.3 step 11; Phase 2 B12 notifications.
-- Enqueueing is driven by booking_events (every booking RPC already logs one, with the business's
-- "notify" choice), so no booking write path changes. Dispatch happens in the notify-dispatch Edge
-- Function, which claims due rows here and reports each attempt back.

-- ─── Tables ────────────────────────────────────────────────────────────────
create table public.notification_templates (
  type                    public.notification_type not null,
  channel                 public.notification_channel not null,
  locale                  public.app_locale not null,
  version                 int not null default 1,
  provider_template_name  text,                      -- WhatsApp approved template name
  body                    text not null,             -- rendering source for sms / in_app (and the WhatsApp copy submitted to Meta)
  variables               text[] not null default '{}',  -- WhatsApp body parameter order
  buttons                 text[] not null default '{}',  -- WhatsApp quick replies, in order: 'confirm' | 'cancel'
  status                  text not null default 'draft' check (status in ('draft', 'pending_approval', 'approved', 'rejected')),
  is_active               boolean not null default false,
  created_at              timestamptz not null default now(),
  primary key (type, channel, locale, version)
);
create unique index on public.notification_templates (type, channel, locale) where is_active;

create table public.notifications (                  -- outbox + in-app inbox
  id                     uuid primary key default gen_random_uuid(),
  type                   public.notification_type not null,
  recipient_user_id      uuid references auth.users(id) on delete cascade,
  recipient_phone        text check (recipient_phone ~ '^\+[1-9][0-9]{7,14}$'),
  recipient_business_id  uuid references public.businesses(id),
  booking_id             uuid references public.bookings(id) on delete cascade,
  review_id              uuid,                       -- FK added with reviews (M9)
  payload                jsonb not null default '{}',
  locale                 public.app_locale not null default 'en',
  dedupe_key             text unique,
  scheduled_for          timestamptz not null default now(),
  status                 public.notification_status not null default 'queued',
  channel_override       public.notification_channel,  -- set when a critical WhatsApp message falls back to SMS after a failed receipt
  attempts               smallint not null default 0,
  last_error             text,
  sent_at                timestamptz,
  read_at                timestamptz,
  created_at             timestamptz not null default now(),
  check (recipient_user_id is not null or recipient_phone is not null)
);
create index on public.notifications (status, scheduled_for) where status = 'queued';
create index on public.notifications (recipient_user_id, created_at desc);
create index on public.notifications (booking_id);
create index on public.notifications (recipient_business_id, created_at desc);

create table public.notification_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  notification_id      uuid not null references public.notifications(id) on delete cascade,
  channel              public.notification_channel not null,
  provider             text not null,                -- 'whatsapp' | 'twilio' | 'log' | 'expo' | …
  provider_message_id  text,
  status               public.delivery_status not null default 'queued',
  error_code           text,
  cost_micros          bigint,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index on public.notification_deliveries (provider, provider_message_id) where provider_message_id is not null;
create index on public.notification_deliveries (notification_id);
create trigger notification_deliveries_updated_at before update on public.notification_deliveries
  for each row execute function private.set_updated_at();

create table public.notification_preferences (
  user_id   uuid not null references auth.users(id) on delete cascade,
  channel   public.notification_channel not null,
  enabled   boolean not null default true,
  primary key (user_id, channel)
);

create table public.business_notification_settings (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  type         public.notification_type not null,
  channels     public.notification_channel[] not null default '{whatsapp,push}',
  primary key (business_id, user_id, type)
);

create table public.push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  expo_token    text not null unique,
  platform      text not null check (platform in ('ios', 'android')),
  last_seen_at  timestamptz not null default now(),
  disabled_at   timestamptz
);

create table private.whatsapp_inbound (
  id                   uuid primary key default gen_random_uuid(),
  provider_message_id  text not null unique,
  from_phone           text not null,
  kind                 text not null check (kind in ('button', 'text', 'status')),
  payload              jsonb not null,
  processed_at         timestamptz,
  created_at           timestamptz not null default now()
);

create table private.notification_routes (
  type               public.notification_type primary key,
  primary_channels   public.notification_channel[] not null,
  fallback_channels  public.notification_channel[] not null default '{}',
  critical           boolean not null default false
);
insert into private.notification_routes (type, primary_channels, fallback_channels, critical)
select t::public.notification_type, '{whatsapp}', '{sms}', true
from unnest(array['booking_confirmed', 'booking_requested', 'request_accepted', 'request_declined', 'request_expired',
                  'booking_reminder_24h', 'booking_reminder_2h', 'booking_cancelled_by_business',
                  'booking_rescheduled_by_business', 'staff_changed', 'booking_no_show_marked']) t;
insert into private.notification_routes (type, primary_channels, fallback_channels, critical)
select t::public.notification_type, '{whatsapp}', '{}', false
from unnest(array['biz_new_booking', 'biz_new_request', 'biz_booking_cancelled']) t;

-- Deployment settings read by SQL (web base URL for links in messages)
create table private.app_settings (
  key    text primary key,
  value  text not null
);
insert into private.app_settings values ('web_base_url', 'http://127.0.0.1:3000');

create function private.app_setting(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select value from private.app_settings where key = p_key
$$;

-- ─── RLS: recipients read their own inbox; everything else goes through RPCs ─
alter table public.notification_templates         enable row level security;
alter table public.notifications                  enable row level security;
alter table public.notification_deliveries        enable row level security;
alter table public.notification_preferences       enable row level security;
alter table public.business_notification_settings enable row level security;
alter table public.push_tokens                    enable row level security;

grant select on public.notifications, public.notification_preferences, public.push_tokens to authenticated;
revoke insert, update, delete on public.notifications, public.notification_deliveries, public.notification_templates,
  public.notification_preferences, public.business_notification_settings, public.push_tokens from authenticated, anon;

create policy notifications_own on public.notifications for select to authenticated
  using (recipient_user_id = (select private.uid()));
create policy preferences_own on public.notification_preferences for select to authenticated
  using (user_id = (select private.uid()));
create policy push_tokens_own on public.push_tokens for select to authenticated
  using (user_id = (select private.uid()));

-- ─── Enqueue ───────────────────────────────────────────────────────────────
create function private.enqueue_notification(
  p_type public.notification_type, p_booking_id uuid, p_user_id uuid, p_phone text, p_business_id uuid,
  p_payload jsonb, p_locale public.app_locale, p_dedupe text default null, p_at timestamptz default now())
returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.notifications (type, booking_id, recipient_user_id, recipient_phone, recipient_business_id,
                                    payload, locale, dedupe_key, scheduled_for)
  select p_type, p_booking_id, p_user_id, p_phone, p_business_id, coalesce(p_payload, '{}'), coalesce(p_locale, 'en'),
         p_dedupe, coalesce(p_at, now())
  where p_user_id is not null or p_phone is not null
  on conflict (dedupe_key) do nothing
$$;

-- Everything a booking message can show (formatted per locale by the dispatcher). The link is a
-- claim_visit link for business-created bookings of customers without an account (it also lets
-- them manage the booking), otherwise a manage_booking link.
create function private.booking_payload(p_booking_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings; v jsonb; v_token text; v_purpose text; v_base text := private.app_setting('web_base_url');
begin
  select * into b from public.bookings where id = p_booking_id;
  v_purpose := case when b.customer_user_id is null and b.source in ('manual', 'walk_in') then 'claim_visit' else 'manage_booking' end;
  begin
    v_token := private.issue_access_token(v_purpose, b.id);
  exception when sqlstate 'P0001' then
    v_token := null;                                   -- e.g. walk-in without a phone: no link
  end;
  select jsonb_build_object(
    'booking_id', b.id, 'ref', b.ref, 'starts_at', b.starts_at, 'timezone', l.timezone,
    'business_name', biz.name, 'business_phone', l.phone_e164,
    'service_name', sv.name, 'staff_name', split_part(s.display_name, ' ', 1),
    'customer_name', split_part(coalesce(bc.display_name, ''), ' ', 1),
    'link', case when v_token is not null then v_base || '/m/' || v_token end,
    'dashboard_link', v_base || '/biz/' || b.business_id || '/bookings')
  into v
  from public.bookings bb
  join public.businesses biz on biz.id = bb.business_id
  join public.business_locations l on l.id = bb.location_id
  left join public.booking_items bi on bi.booking_id = bb.id and bi.position = 1
  left join public.services sv on sv.id = bi.service_id
  left join public.staff_members s on s.id = bi.staff_id
  left join public.business_customers bc on bc.id = bb.business_customer_id
  where bb.id = b.id;
  return v;
end $$;

-- Customer of a booking: account (profile phone + locale) or the business's record
create function private.booking_customer(p_booking_id uuid, out user_id uuid, out phone text, out locale public.app_locale)
language sql stable security definer set search_path = '' as $$
  select b.customer_user_id,
         coalesce(case when p.status <> 'deleted' then p.phone_e164 end, bc.phone_e164),
         coalesce(p.locale, 'en'::public.app_locale)
  from public.bookings b
  left join public.profiles p on p.id = b.customer_user_id
  left join public.business_customers bc on bc.id = b.business_customer_id
  where b.id = p_booking_id
$$;

create function private.notify_customer(p_type public.notification_type, p_booking_id uuid,
                                        p_extra jsonb default '{}', p_dedupe text default null,
                                        p_at timestamptz default now())
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare c record;
begin
  select * into c from private.booking_customer(p_booking_id);
  if c.phone is null and c.user_id is null then return; end if;
  perform private.enqueue_notification(p_type, p_booking_id, c.user_id, c.phone, null,
                                       private.booking_payload(p_booking_id) || coalesce(p_extra, '{}'),
                                       c.locale, p_dedupe, p_at);
end $$;

-- Business alerts: members chosen in B12 settings; by default owners and managers, on WhatsApp
create function private.notify_business(p_type public.notification_type, p_booking_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings; r record; v_payload jsonb; v_custom boolean;
begin
  select * into b from public.bookings where id = p_booking_id;
  select exists (select 1 from public.business_notification_settings where business_id = b.business_id and type = p_type)
    into v_custom;
  v_payload := private.booking_payload(p_booking_id) - 'link';
  for r in
    select m.user_id, p.phone_e164, p.locale
    from public.business_members m join public.profiles p on p.id = m.user_id
    where m.business_id = b.business_id and m.status = 'active' and p.status <> 'deleted'
      and case when v_custom
               then exists (select 1 from public.business_notification_settings s
                            where s.business_id = b.business_id and s.user_id = m.user_id and s.type = p_type
                              and 'whatsapp' = any(s.channels))
               else m.role in ('owner', 'manager') end
  loop
    perform private.enqueue_notification(p_type, p_booking_id, r.user_id, r.phone_e164, b.business_id, v_payload, r.locale,
                                         p_type || ':' || p_booking_id || ':' || r.user_id);
  end loop;
end $$;

-- Reminders 24 h and 2 h before; skipped when the booking is made closer than that. The start
-- time is part of the dedupe key, so a reschedule creates fresh ones.
create function private.schedule_reminders(p_booking_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings; v_epoch text;
begin
  select * into b from public.bookings where id = p_booking_id;
  update public.notifications set status = 'cancelled'
   where booking_id = p_booking_id and status = 'queued' and type in ('booking_reminder_24h', 'booking_reminder_2h');
  if b.status <> 'confirmed' then return; end if;
  v_epoch := extract(epoch from b.starts_at)::bigint::text;
  if b.starts_at - interval '24 hours' > now() then
    perform private.notify_customer('booking_reminder_24h', b.id, '{}',
      'reminder_24h:' || b.id || ':' || v_epoch, b.starts_at - interval '24 hours');
  end if;
  if b.starts_at - interval '2 hours' > now() then
    perform private.notify_customer('booking_reminder_2h', b.id, '{}',
      'reminder_2h:' || b.id || ':' || v_epoch, b.starts_at - interval '2 hours');
  end if;
end $$;

create function private.cancel_reminders(p_booking_id uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.notifications set status = 'cancelled'
   where booking_id = p_booking_id and status = 'queued' and type in ('booking_reminder_24h', 'booking_reminder_2h')
$$;

-- One trigger turns booking events into messages (Part 3 §4.3 step 11 and the §4.4 notify rules)
create function private.on_booking_event() returns trigger
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
  end if;
  return null;
end $$;
create trigger booking_events_notify after insert on public.booking_events
  for each row execute function private.on_booking_event();

-- ─── Dispatch (service_role only; called by the notify-dispatch Edge Function) ─
-- Claims due rows (skip locked) and returns what the dispatcher needs: channel order (preferences
-- applied), the template per channel (the locale's approved one, else English), and the payload.
-- Stale reminders (booking no longer confirmed / moved) are cancelled here instead of sent.
create function public.notify_claim(p_limit int default 50) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v jsonb;
begin
  update public.notifications n set status = 'cancelled'
  from public.bookings b
  where n.booking_id = b.id and n.status = 'queued' and n.scheduled_for <= now()
    and n.type in ('booking_reminder_24h', 'booking_reminder_2h')
    and (b.status <> 'confirmed' or (n.payload ->> 'starts_at')::timestamptz <> b.starts_at);

  with due as (
    select id from public.notifications
    where status = 'queued' and scheduled_for <= now() and recipient_phone is not null
    order by scheduled_for limit least(greatest(coalesce(p_limit, 50), 1), 500)
    for update skip locked
  ), claimed as (
    update public.notifications n set status = 'processing', attempts = n.attempts + 1
    from due where n.id = due.id
    returning n.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'type', c.type, 'locale', c.locale, 'phone', c.recipient_phone, 'attempts', c.attempts,
           'payload', c.payload, 'critical', coalesce(r.critical, false),
           'channels', (select coalesce(jsonb_agg(ch), '[]') from unnest(
                          case when c.channel_override is not null then array[c.channel_override]
                               else coalesce(r.primary_channels, '{whatsapp}') || case when coalesce(r.critical, false)
                                                                                         then r.fallback_channels else '{}' end end) ch
                        where ch in ('whatsapp', 'sms')
                          and not exists (select 1 from public.notification_preferences p
                                          where p.user_id = c.recipient_user_id and p.channel = ch and not p.enabled)),
           'templates', (select coalesce(jsonb_object_agg(t.channel, to_jsonb(t) - 'created_at'), '{}')
                         from (select distinct on (t.channel) t.*
                               from public.notification_templates t
                               where t.type = c.type and t.is_active and t.locale in (c.locale, 'en')
                               order by t.channel, (t.status = 'approved') desc, (t.locale = c.locale) desc) t))), '[]')
    into v
  from claimed c left join private.notification_routes r on r.type = c.type;
  return v;
end $$;

create function public.notify_record_attempt(p_notification_id uuid, p_channel public.notification_channel,
                                             p_provider text, p_message_id text, p_ok boolean, p_error text)
returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.notification_deliveries (notification_id, channel, provider, provider_message_id, status, error_code)
  values (p_notification_id, p_channel, p_provider, p_message_id,
          case when p_ok then 'sent' else 'failed' end::public.delivery_status, left(p_error, 300))
  on conflict (provider, provider_message_id) where provider_message_id is not null do nothing
$$;

-- Final state of one dispatch: sent · retry (backoff 1, 5, 15 min; max 4 attempts) · failed
create function public.notify_finish(p_notification_id uuid, p_outcome text, p_error text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare n public.notifications;
begin
  select * into n from public.notifications where id = p_notification_id for update;
  if n.id is null or n.status <> 'processing' then return; end if;
  if p_outcome = 'sent' then
    update public.notifications set status = 'sent', sent_at = now(), last_error = null where id = n.id;
  elsif p_outcome = 'retry' and n.attempts < 4 then
    update public.notifications set status = 'queued', last_error = left(p_error, 300),
           scheduled_for = now() + make_interval(mins => (array[1, 5, 15])[least(n.attempts, 3)])
     where id = n.id;
  else
    update public.notifications set status = 'failed', last_error = left(p_error, 300) where id = n.id;
  end if;
end $$;

-- Delivery receipts (WhatsApp / Twilio). A critical WhatsApp message that fails after it was
-- accepted gets one SMS retry. Receipts for OTP messages are passed on to the M4 table.
create function public.notify_status_update(p_provider text, p_message_id text, p_status text,
                                            p_error text default null, p_at timestamptz default null)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare d public.notification_deliveries; n public.notifications; v_critical boolean;
begin
  select * into d from public.notification_deliveries where provider = p_provider and provider_message_id = p_message_id;
  if d.id is null then
    perform public.otp_status_update(p_provider, p_message_id, p_status, p_error, p_at);
    return;
  end if;
  update public.notification_deliveries
     set status = case p_status when 'undelivered' then 'failed' else p_status end::public.delivery_status,
         error_code = coalesce(left(p_error, 300), error_code)
   where id = d.id
     -- receipts can arrive out of order: never go back from delivered/read to sent
     and not (status in ('delivered', 'read') and p_status = 'sent');
  if p_status in ('failed', 'undelivered') and d.channel = 'whatsapp' then
    select * into n from public.notifications where id = d.notification_id for update;
    select coalesce(critical, false) into v_critical from private.notification_routes where type = n.type;
    if v_critical and n.status = 'sent'
       and not exists (select 1 from public.notification_deliveries x where x.notification_id = n.id and x.channel = 'sms') then
      update public.notifications set status = 'queued', channel_override = 'sms', scheduled_for = now(),
             last_error = left(coalesce(p_error, 'whatsapp failed'), 300)
       where id = n.id;
    end if;
  end if;
end $$;

-- ─── WhatsApp buttons (Confirm / Cancel) ─────────────────────────────────
-- Confirm sets customer_confirmed_at only when the sender's phone is the booking customer's.
create function private.customer_confirm_attendance(p_booking_id uuid, p_from_phone text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare b public.bookings; c record;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if b.id is null or b.status <> 'confirmed' or b.starts_at <= now() then return false; end if;
  select * into c from private.booking_customer(p_booking_id);
  if c.phone is null or c.phone <> '+' || regexp_replace(p_from_phone, '\D', '', 'g') then return false; end if;
  if b.customer_confirmed_at is null then
    update public.bookings set customer_confirmed_at = now() where id = b.id;
    perform private.log_booking_event(b.id, 'customer_confirmed', 'customer', b.status, b.status, '{"via":"whatsapp"}');
  end if;
  return true;
end $$;

-- Called by the whatsapp-webhook for a button reply. Idempotent per provider message id.
-- Returns the reply to send back in the open 24 h session (null = nothing to send).
create function public.whatsapp_button(p_message_id text, p_from_phone text, p_payload text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_action text := split_part(coalesce(p_payload, ''), ':', 1); v_booking uuid; v_ok boolean; v jsonb; c record;
begin
  insert into private.whatsapp_inbound (provider_message_id, from_phone, kind, payload)
  values (p_message_id, p_from_phone, 'button', jsonb_build_object('payload', p_payload))
  on conflict (provider_message_id) do nothing;
  if not found then return null; end if;                   -- Meta retried a webhook we already handled

  begin
    v_booking := split_part(p_payload, ':', 2)::uuid;
  exception when others then
    v_booking := null;
  end;
  if v_booking is null or v_action not in ('confirm', 'cancel') then
    update private.whatsapp_inbound set processed_at = now() where provider_message_id = p_message_id;
    return null;
  end if;
  select * into c from private.booking_customer(v_booking);
  if c.phone is distinct from '+' || regexp_replace(p_from_phone, '\D', '', 'g') then
    update private.whatsapp_inbound set processed_at = now() where provider_message_id = p_message_id;
    return jsonb_build_object('reply', 'not_yours', 'locale', 'en');
  end if;
  v := private.booking_payload(v_booking);
  if v_action = 'confirm' then
    v_ok := private.customer_confirm_attendance(v_booking, p_from_phone);
    v := v || jsonb_build_object('reply', case when v_ok then 'confirmed' else 'cannot_confirm' end);
  else
    -- Cancel never cancels directly: the customer gets the manage link and sees the policy first
    v := v || jsonb_build_object('reply', 'cancel_link');
  end if;
  update private.whatsapp_inbound set processed_at = now() where provider_message_id = p_message_id;
  return v || jsonb_build_object('locale', c.locale);
end $$;

-- ─── Customer preferences + in-app inbox ──────────────────────────────────
create function public.get_my_notification_preferences()
returns table (channel public.notification_channel, enabled boolean)
language sql stable security definer set search_path = '' as $$
  select ch, coalesce((select p.enabled from public.notification_preferences p
                       where p.user_id = private.uid() and p.channel = ch), true)
  from unnest(array['whatsapp', 'sms', 'push', 'email']::public.notification_channel[]) ch
$$;

-- At least one of push / WhatsApp / SMS must stay on (booking messages have to reach you)
create function public.set_notification_preference(p_channel public.notification_channel, p_enabled boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.uid();
begin
  if v_uid is null or coalesce((private.jwt() ->> 'is_anonymous')::boolean, false) then perform private.raise_code('AUTH_REQUIRED'); end if;
  if p_channel not in ('whatsapp', 'sms', 'push', 'email') then perform private.raise_code('INVALID_INPUT'); end if;
  insert into public.notification_preferences (user_id, channel, enabled) values (v_uid, p_channel, p_enabled)
  on conflict (user_id, channel) do update set enabled = excluded.enabled;
  if not exists (select 1 from public.get_my_notification_preferences() p
                 where p.channel in ('whatsapp', 'sms', 'push') and p.enabled) then
    perform private.raise_code('LAST_CHANNEL');
  end if;
end $$;

create function public.get_my_notifications(p_before timestamptz default null, p_limit int default 30)
returns table (id uuid, type public.notification_type, booking_id uuid, payload jsonb, created_at timestamptz, read_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select n.id, n.type, n.booking_id, n.payload - 'dashboard_link', n.created_at, n.read_at
  from public.notifications n
  where n.recipient_user_id = private.uid() and n.status <> 'cancelled' and n.scheduled_for <= now()
    and (p_before is null or n.created_at < p_before)
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

create function public.mark_notifications_read(p_ids uuid[]) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  update public.notifications set read_at = now()
   where id = any(coalesce(p_ids, '{}')) and recipient_user_id = private.uid() and read_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ─── B12 business notification settings ─────────────────────────────────
-- Who gets which alert on WhatsApp. Without rows for a type: owners and managers.
create function public.biz_get_notification_settings(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.business_role := private.my_role(p_business_id);
begin
  if v_role is null or v_role = 'staff' then perform private.raise_code('FORBIDDEN'); end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'user_id', m.user_id, 'role', m.role,
             'name', coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Team member'),
             'has_phone', p.phone_e164 is not null, 'me', m.user_id = private.uid(),
             'alerts', (select jsonb_object_agg(t, case
                          when exists (select 1 from public.business_notification_settings s where s.business_id = p_business_id and s.type = t::public.notification_type)
                          then exists (select 1 from public.business_notification_settings s
                                       where s.business_id = p_business_id and s.user_id = m.user_id
                                         and s.type = t::public.notification_type and 'whatsapp' = any(s.channels))
                          else m.role in ('owner', 'manager') end)
                        from unnest(array['biz_new_booking', 'biz_new_request', 'biz_booking_cancelled']) t))
           order by array_position(array['owner', 'manager', 'reception', 'staff']::public.business_role[], m.role), p.first_name)
    from public.business_members m join public.profiles p on p.id = m.user_id
    where m.business_id = p_business_id and m.status = 'active'), '[]');
end $$;

-- Owners/managers set anyone; others only themselves. The first change for a type materialises the
-- defaults for everyone so nobody silently loses alerts.
create function public.biz_set_notification_setting(p_business_id uuid, p_user_id uuid,
                                                    p_type public.notification_type, p_whatsapp boolean)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_role public.business_role := private.my_role(p_business_id);
begin
  if v_role is null or v_role = 'staff'
     or (v_role not in ('owner', 'manager') and p_user_id is distinct from private.uid()) then
    perform private.raise_code('FORBIDDEN');
  end if;
  if p_type not in ('biz_new_booking', 'biz_new_request', 'biz_booking_cancelled') then perform private.raise_code('INVALID_INPUT'); end if;
  if not exists (select 1 from public.business_members where business_id = p_business_id and user_id = p_user_id and status = 'active') then
    perform private.raise_code('NOT_FOUND');
  end if;
  if not exists (select 1 from public.business_notification_settings where business_id = p_business_id and type = p_type) then
    insert into public.business_notification_settings (business_id, user_id, type, channels)
    select p_business_id, m.user_id, p_type, '{whatsapp}'
    from public.business_members m where m.business_id = p_business_id and m.status = 'active' and m.role in ('owner', 'manager');
  end if;
  insert into public.business_notification_settings (business_id, user_id, type, channels)
  values (p_business_id, p_user_id, p_type, case when p_whatsapp then '{whatsapp}' else '{}' end::public.notification_channel[])
  on conflict (business_id, user_id, type) do update set channels = excluded.channels;
end $$;

-- B2 attention: customer messages that failed (last 7 days) and alert recipients without a phone
create function public.biz_notification_health(p_business_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role public.business_role := private.my_role(p_business_id);
begin
  if v_role is null or v_role = 'staff' then perform private.raise_code('FORBIDDEN'); end if;
  return jsonb_build_object(
    'failed_7d', (select count(*) from public.notifications n join public.bookings b on b.id = n.booking_id
                  where b.business_id = p_business_id and n.recipient_business_id is null and n.status = 'failed'
                    and n.created_at > now() - interval '7 days'),
    'sent_7d', (select count(*) from public.notifications n join public.bookings b on b.id = n.booking_id
                where b.business_id = p_business_id and n.recipient_business_id is null and n.status = 'sent'
                  and n.created_at > now() - interval '7 days'));
end $$;

-- ─── Ops report (DoD: ≥ 95 % delivery; Confirm-button usage measured) ─────
create function public.admin_notification_stats(p_days int default 7)
returns table (type public.notification_type, total int, sent int, delivered int, failed int,
               via_sms_fallback int, success_rate numeric, confirmed_by_button int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin('{ops}') then perform private.raise_code('FORBIDDEN'); end if;
  return query
  with n as (
    select * from public.notifications
    where created_at > now() - make_interval(days => least(greatest(p_days, 1), 90)) and status <> 'cancelled'
  )
  select n.type, count(*)::int,
         count(*) filter (where n.status = 'sent')::int,
         count(*) filter (where exists (select 1 from public.notification_deliveries d
                                        where d.notification_id = n.id and d.status in ('delivered', 'read')))::int,
         count(*) filter (where n.status = 'failed')::int,
         count(*) filter (where exists (select 1 from public.notification_deliveries d
                                        where d.notification_id = n.id and d.channel = 'sms' and d.status <> 'failed'))::int,
         round(100.0 * count(*) filter (where n.status = 'sent') / nullif(count(*) filter (where n.status in ('sent', 'failed')), 0), 1),
         count(*) filter (where n.type in ('booking_reminder_24h', 'booking_reminder_2h', 'booking_confirmed')
                            and exists (select 1 from public.booking_events e where e.booking_id = n.booking_id
                                        and e.event = 'customer_confirmed' and e.created_at > n.created_at))::int
  from n group by n.type order by n.type;
end $$;

-- ─── Dispatch job: pg_cron → notify-dispatch (URL + shared secret from Vault) ─
-- Inline SQL (pg_cron runs it as postgres): app_owner-owned functions can't read Vault. Nothing is
-- called when nothing is due or when the environment has no Vault entries (e.g. CI).
select cron.schedule('app_notify_dispatch', '* * * * *', $job$
  select net.http_post(
           url := u.decrypted_secret, body := '{}'::jsonb,
           headers := jsonb_build_object('Content-Type', 'application/json', 'x-dispatch-secret', s.decrypted_secret),
           timeout_milliseconds := 55000)
  from vault.decrypted_secrets u, vault.decrypted_secrets s
  where u.name = 'notify_dispatch_url' and s.name = 'notify_dispatch_secret'
    and exists (select 1 from public.notifications where status = 'queued' and scheduled_for <= now())
$job$);

-- ─── Grants ────────────────────────────────────────────────────────────────
revoke execute on function public.notify_claim(int), public.notify_record_attempt(uuid, public.notification_channel, text, text, boolean, text),
  public.notify_finish(uuid, text, text), public.notify_status_update(text, text, text, text, timestamptz),
  public.whatsapp_button(text, text, text) from public, anon, authenticated;
grant execute on function public.notify_claim(int), public.notify_record_attempt(uuid, public.notification_channel, text, text, boolean, text),
  public.notify_finish(uuid, text, text), public.notify_status_update(text, text, text, text, timestamptz),
  public.whatsapp_button(text, text, text) to service_role;
grant execute on function public.get_my_notification_preferences()                          to authenticated;
grant execute on function public.set_notification_preference(public.notification_channel, boolean) to authenticated;
grant execute on function public.get_my_notifications(timestamptz, int)                     to authenticated;
grant execute on function public.mark_notifications_read(uuid[])                            to authenticated;
grant execute on function public.biz_get_notification_settings(uuid)                        to authenticated;
grant execute on function public.biz_set_notification_setting(uuid, uuid, public.notification_type, boolean) to authenticated;
grant execute on function public.biz_notification_health(uuid)                              to authenticated;
grant execute on function public.admin_notification_stats(int)                              to authenticated;

select private.assign_app_ownership();
