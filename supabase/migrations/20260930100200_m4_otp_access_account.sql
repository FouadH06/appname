-- M4 · OTP delivery routing (Send SMS Hook), caller access summary, account deletion skeleton
-- Spec: Phase 3 Part 6 §7 (WhatsApp-first Send SMS hook, OTP rate limits, MFA for admins),
--       Part 2 §1.1 (delete_my_account → service job), Phase 2 C10 (WhatsApp first, SMS after 30 s).
-- Decisions (review 2026-09-28): WhatsApp Cloud API primary, Twilio SMS fallback, both behind a
-- provider interface in the Edge Function; this file owns the routing state and limits.

-- ─── OTP deliveries (private; phone PII kept 30 days) ──────────────────────
create table private.otp_deliveries (
  id                   uuid primary key default gen_random_uuid(),
  phone_e164           text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  channel              text not null check (channel in ('whatsapp', 'sms', 'log')),
  provider             text,
  status               text not null default 'queued'
                       check (status in ('queued', 'sent', 'failed', 'delivered', 'read', 'undelivered')),
  provider_message_id  text,
  error_code           text check (char_length(error_code) <= 200),
  is_fallback          boolean not null default false,
  created_at           timestamptz not null default now(),
  sent_at              timestamptz,
  delivered_at         timestamptz
);
create index on private.otp_deliveries (phone_e164, created_at desc);
create index on private.otp_deliveries (created_at);
create unique index otp_deliveries_provider_msg on private.otp_deliveries (provider, provider_message_id)
  where provider_message_id is not null;

-- ─── otp_route: called by the Send SMS Hook (service_role only) ────────────
-- p_phone: GoTrue's phone (digits, no '+'). p_sms_prefixes: E.164 prefixes where SMS fallback is
-- allowed (cost control for foreign numbers; WhatsApp works everywhere).
-- p_force_channel: 'sms' when the hook falls back after a WhatsApp send error in the same request.
-- Routing: a new request for a number that got a WhatsApp code 25 s–10 min ago means "Send by SMS
-- instead" (Phase 2 C10: offered after 30 s; GoTrue's resend interval enforces the wait).
create function public.otp_route(p_phone text, p_sms_prefixes text[] default '{+961}',
                                 p_force_channel text default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_phone text := private.normalize_phone('+' || ltrim(coalesce(p_phone, ''), '+'));
  v_sms_ok boolean;
  v_recent_whatsapp boolean;
  v_15m int; v_24h int;
  v_channel text; v_id uuid;
begin
  if v_phone is null then return jsonb_build_object('allowed', false, 'reason', 'INVALID_PHONE'); end if;
  v_sms_ok := exists (select 1 from unnest(coalesce(p_sms_prefixes, '{}')) p where v_phone like p || '%');

  if p_force_channel is null then
    -- per-number limits (GoTrue adds per-IP limits; Turnstile blocks bots before this point)
    select count(*) filter (where created_at > now() - interval '15 minutes'), count(*)
      into v_15m, v_24h
    from private.otp_deliveries
    where phone_e164 = v_phone and not is_fallback and created_at > now() - interval '24 hours';
    if v_15m >= 5 or v_24h >= 10 then
      return jsonb_build_object('allowed', false, 'reason', 'OTP_TOO_MANY');
    end if;

    v_recent_whatsapp := exists (
      select 1 from private.otp_deliveries
      where phone_e164 = v_phone and channel = 'whatsapp'
        and created_at between now() - interval '10 minutes' and now() - interval '25 seconds'
        and not exists (select 1 from private.otp_deliveries s
                        where s.phone_e164 = v_phone and s.channel = 'sms' and s.created_at > now() - interval '10 minutes'));
    v_channel := case when v_recent_whatsapp and v_sms_ok then 'sms' else 'whatsapp' end;
  else
    if p_force_channel not in ('whatsapp', 'sms') then
      return jsonb_build_object('allowed', false, 'reason', 'NOT_SUPPORTED');
    end if;
    if p_force_channel = 'sms' and not v_sms_ok then
      return jsonb_build_object('allowed', false, 'reason', 'SMS_NOT_AVAILABLE');
    end if;
    v_channel := p_force_channel;
  end if;

  insert into private.otp_deliveries (phone_e164, channel, is_fallback)
  values (v_phone, v_channel, p_force_channel is not null)
  returning id into v_id;
  return jsonb_build_object('allowed', true, 'channel', v_channel, 'delivery_id', v_id, 'phone', v_phone,
                            'sms_available', v_sms_ok);
end $$;

-- Result of the provider call (hook) and later delivery receipts (status webhook)
create function public.otp_mark(p_delivery_id uuid, p_status text, p_provider text,
                                p_message_id text default null, p_error text default null)
returns void
language sql volatile security definer set search_path = '' as $$
  update private.otp_deliveries set
    status = p_status,
    provider = coalesce(p_provider, provider),
    provider_message_id = coalesce(p_message_id, provider_message_id),
    error_code = left(p_error, 200),
    sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_delivery_id
$$;

create function public.otp_status_update(p_provider text, p_message_id text, p_status text,
                                         p_error text default null, p_at timestamptz default null)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_status not in ('sent', 'delivered', 'read', 'failed', 'undelivered') then return false; end if;
  update private.otp_deliveries set
    -- never move backwards (receipts can arrive out of order)
    status = case
      when status in ('delivered', 'read') and p_status in ('sent', 'failed', 'undelivered') then status
      when status = 'read' and p_status = 'delivered' then status
      else p_status end,
    delivered_at = case when p_status in ('delivered', 'read') and delivered_at is null
                        then coalesce(p_at, now()) else delivered_at end,
    error_code = coalesce(left(p_error, 200), error_code)
  where provider = p_provider and provider_message_id = p_message_id;
  return found;
end $$;

-- Delivery stats for ops (M4 DoD: median delivery time per channel)
create function public.admin_otp_delivery_stats(p_days int default 7)
returns table (channel text, sent int, delivered int, failed int,
               median_seconds numeric, p90_seconds numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin('{ops}') then perform private.raise_code('FORBIDDEN'); end if;
  return query
  select d.channel, count(*)::int,
         count(*) filter (where d.delivered_at is not null)::int,
         count(*) filter (where d.status in ('failed', 'undelivered'))::int,
         round((percentile_cont(0.5) within group (order by extract(epoch from d.delivered_at - d.created_at)))::numeric, 1),
         round((percentile_cont(0.9) within group (order by extract(epoch from d.delivered_at - d.created_at)))::numeric, 1)
  from private.otp_deliveries d
  where d.created_at > now() - make_interval(days => least(greatest(p_days, 1), 30))
  group by d.channel order by d.channel;
end $$;

create function private.job_otp_cleanup() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from private.otp_deliveries where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- ─── get_my_access: who am I, for app routing (business login, admin MFA gate) ──
-- Tells an admin with aal1 that MFA is still needed; is_admin() itself stays aal2-only.
create function public.get_my_access() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.uid(); p public.profiles; a public.admin_users;
begin
  if v_uid is null then perform private.raise_code('AUTH_REQUIRED'); end if;
  select * into p from public.profiles where id = v_uid;
  select * into a from public.admin_users where user_id = v_uid and is_active;
  return jsonb_build_object(
    'user_id', v_uid,
    'is_anonymous', private.is_anonymous(),
    'phone_verified', p.phone_verified_at is not null and not private.is_anonymous(),
    'phone_hint', private.mask_phone(p.phone_e164),
    'first_name', p.first_name,
    'status', p.status,
    'aal', coalesce(private.jwt() ->> 'aal', 'aal1'),
    'admin_role', a.role,
    'admin_mfa_ok', a.role is not null and coalesce(private.jwt() ->> 'aal', '') = 'aal2',
    'memberships', (select coalesce(jsonb_agg(jsonb_build_object(
                             'business_id', z.id, 'business_name', z.name, 'slug', z.slug,
                             'business_status', z.status, 'role', m.role) order by z.name), '[]')
                    from public.business_members m join public.businesses z on z.id = m.business_id
                    where m.user_id = v_uid and m.status = 'active' and not private.is_anonymous()));
end $$;

-- ─── Account deletion (skeleton; Part 2 §1.1) ──────────────────────────────
-- The RPC records the request; the job does the database side. Deleting the auth.users row needs
-- the Auth admin API, so a service worker (M7/ops) does that last and stamps auth_deleted_at.
-- Reviews/results removal joins this job in M9/M10.
create table private.account_deletions (
  user_id          uuid primary key,
  requested_at     timestamptz not null default now(),
  status           text not null default 'requested'
                   check (status in ('requested', 'processed', 'needs_support')),
  note             text,
  processed_at     timestamptz,
  auth_deleted_at  timestamptz
);

create function public.delete_my_account() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := private.uid();
begin
  if v_uid is null or private.is_anonymous() then perform private.raise_code('AUTH_REQUIRED'); end if;
  insert into private.account_deletions (user_id) values (v_uid) on conflict (user_id) do nothing;
  return jsonb_build_object('status', 'requested');
end $$;

create function private.job_process_account_deletions() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; b record; n int := 0;
begin
  for r in select * from private.account_deletions where status = 'requested'
           order by requested_at limit 50 for update skip locked
  loop
    -- An active owner must hand the business over first (support-assisted)
    if exists (select 1 from public.business_members where user_id = r.user_id and role = 'owner' and status = 'active') then
      update private.account_deletions set status = 'needs_support', note = 'active business owner' where user_id = r.user_id;
      continue;
    end if;

    delete from public.bookings where hold_owner_user_id = r.user_id and status = 'held';
    for b in select id, status, business_customer_id from public.bookings
             where customer_user_id = r.user_id and status in ('pending', 'confirmed') and starts_at > now()
             for update
    loop
      update public.bookings set status = 'cancelled', cancelled_by_kind = 'customer', cancel_reason = 'account_deleted'
       where id = b.id;
      perform private.log_booking_event(b.id, 'cancelled', 'customer', b.status, 'cancelled',
                                        '{"notify":true,"reason":"account_deleted"}');
      perform private.recompute_business_customer_stats(b.business_customer_id);
    end loop;

    -- Businesses keep their own records; the link to the person goes. A detached record whose
    -- phone would collide with an existing shadow at that business drops the phone snapshot.
    update public.business_customers bc set user_id = null, claimed_at = null,
      phone_e164 = case when exists (select 1 from public.business_customers s
                                     where s.business_id = bc.business_id and s.user_id is null
                                       and s.archived_at is null and s.phone_e164 = bc.phone_e164)
                        then null else bc.phone_e164 end
    where bc.user_id = r.user_id;
    update public.business_members set status = 'revoked' where user_id = r.user_id and status = 'active';
    update public.staff_members set user_id = null where user_id = r.user_id;
    delete from private.claim_dismissals where user_id = r.user_id;

    update public.profiles set status = 'deleted', deleted_at = now(), first_name = null, last_name = null,
                               email = null, phone_verified_at = null, phone_e164 = null, default_area_id = null
     where id = r.user_id;
    update private.account_deletions set status = 'processed', processed_at = now() where user_id = r.user_id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ─── Grants: hook/webhook functions are service_role only (D10 default privileges) ──
revoke execute on function public.otp_route(text, text[], text)                          from anon, authenticated;
revoke execute on function public.otp_mark(uuid, text, text, text, text)                 from anon, authenticated;
revoke execute on function public.otp_status_update(text, text, text, text, timestamptz) from anon, authenticated;
grant execute on function public.admin_otp_delivery_stats(int) to authenticated;
grant execute on function public.get_my_access()               to authenticated;
grant execute on function public.delete_my_account()           to authenticated;
revoke execute on function private.job_otp_cleanup()                from public;
revoke execute on function private.job_process_account_deletions()  from public;

do $$
declare j text;
begin
  foreach j in array array['app_otp_cleanup', 'app_account_deletions'] loop
    perform cron.unschedule(jobid) from cron.job where jobname = j;
  end loop;
end $$;
select cron.schedule('app_otp_cleanup',       '30 1 * * *',   'select private.job_otp_cleanup()');
select cron.schedule('app_account_deletions', '*/15 * * * *', 'select private.job_process_account_deletions()');

select private.assign_app_ownership();
