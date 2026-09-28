-- M3 · Scheduled jobs (pg_cron, UTC). Idempotent, batched, skip-locked.
-- Spec: Phase 3 Part 3 §6

-- Expired holds are deleted 2 minutes after expiry (availability already ignores them at expiry)
create function private.job_expire_holds() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with doomed as (
    select id from public.bookings
    where status = 'held' and expires_at < now() - interval '2 minutes'
    order by expires_at limit 500 for update skip locked
  )
  delete from public.bookings b using doomed where b.id = doomed.id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Requests past their expiry (which is always <= starts_at) are cancelled by the system
create function private.job_expire_requests() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in
    select id, business_customer_id from public.bookings
    where status = 'pending' and expires_at <= now()
    order by expires_at limit 500 for update skip locked
  loop
    update public.bookings set status = 'cancelled', cancelled_by_kind = 'system', cancel_reason = 'expired'
     where id = r.id;
    perform private.log_booking_event(r.id, 'expired', 'system', 'pending', 'cancelled', '{"notify":true}');
    perform private.recompute_business_customer_stats(r.business_customer_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Confirmed bookings are completed automatically auto_complete_after_minutes after they end
create function private.job_auto_complete() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in
    select b.id, b.customer_user_id, b.business_customer_id
    from public.bookings b join public.business_settings s on s.business_id = b.business_id
    where b.status = 'confirmed' and b.ends_at + make_interval(mins => s.auto_complete_after_minutes) <= now()
    order by b.ends_at limit 500 for update of b skip locked
  loop
    update public.bookings set status = 'completed', completed_by_kind = 'system',
           review_eligible_until = case when customer_user_id is not null then now() + interval '30 days' end
     where id = r.id;
    perform private.log_booking_event(r.id, 'completed', 'system', 'confirmed', 'completed', '{"auto":true}');
    perform private.add_reliability_event(r.customer_user_id, r.id, 'completed');
    perform private.recompute_business_customer_stats(r.business_customer_id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Nightly: reliability decays with time, so scores are recomputed even without new events;
-- old rate-limit windows are removed.
create function private.job_nightly() returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select user_id from private.customer_reliability loop
    perform private.recompute_reliability(r.user_id);
  end loop;
  delete from private.rate_limits where window_start < now() - interval '2 days';
  delete from private.access_tokens where expires_at < now() - interval '30 days';
end $$;

revoke execute on function private.job_expire_holds()    from public;
revoke execute on function private.job_expire_requests() from public;
revoke execute on function private.job_auto_complete()   from public;
revoke execute on function private.job_nightly()         from public;

-- Schedules (idempotent: unschedule first so re-running the migration history is safe)
do $$
declare j text;
begin
  foreach j in array array['app_expire_holds', 'app_expire_requests', 'app_auto_complete', 'app_nightly'] loop
    perform cron.unschedule(jobid) from cron.job where jobname = j;
  end loop;
end $$;
select cron.schedule('app_expire_holds',    '* * * * *',   'select private.job_expire_holds()');
select cron.schedule('app_expire_requests', '* * * * *',   'select private.job_expire_requests()');
select cron.schedule('app_auto_complete',   '*/5 * * * *', 'select private.job_auto_complete()');
select cron.schedule('app_nightly',         '0 1 * * *',   'select private.job_nightly()');

select private.assign_app_ownership();
