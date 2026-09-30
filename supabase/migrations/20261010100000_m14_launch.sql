-- M14 · analytics rollups (Phase 3 Part 5 §7, B11), system health for ops, uptime ping.
-- Lean: metrics come from bookings (no event table); rollups are rebuilt nightly for the last 7 days
-- (late completions / no-show marks change recent days) and today is always computed live.

-- ═══ Daily rollups ══════════════════════════════════════════════════════════
create table public.business_daily_metrics (
  business_id               uuid not null references public.businesses(id) on delete cascade,
  location_id               uuid not null references public.business_locations(id) on delete cascade,
  day                       date not null,               -- Beirut day of the appointment
  bookings_created          int not null default 0,      -- by the day they were made
  bookings_completed        int not null default 0,
  revenue_min               numeric(12,2) not null default 0,
  revenue_max               numeric(12,2) not null default 0,
  cancellations_customer    int not null default 0,
  cancellations_business    int not null default 0,
  late_cancels              int not null default 0,
  no_shows                  int not null default 0,
  new_customers             int not null default 0,
  returning_customers       int not null default 0,
  booked_minutes            int not null default 0,
  available_minutes         int not null default 0,
  src_marketplace           int not null default 0,
  src_business_link         int not null default 0,
  src_manual                int not null default 0,
  src_rebook                int not null default 0,
  built_at                  timestamptz not null default now(),
  primary key (business_id, location_id, day)
);

create table public.staff_daily_metrics (
  staff_id                 uuid not null references public.staff_members(id) on delete cascade,
  business_id              uuid not null references public.businesses(id) on delete cascade,
  day                      date not null,
  bookings_completed       int not null default 0,
  revenue_min              numeric(12,2) not null default 0,
  booked_minutes           int not null default 0,
  available_minutes        int not null default 0,
  specifically_requested   int not null default 0,
  no_shows                 int not null default 0,
  built_at                 timestamptz not null default now(),
  primary key (staff_id, day)
);
create index on public.staff_daily_metrics (business_id, day);

-- Read through biz_get_analytics only (role-aware: reception never sees revenue).
alter table public.business_daily_metrics enable row level security;
alter table public.staff_daily_metrics enable row level security;
revoke all on public.business_daily_metrics, public.staff_daily_metrics from anon, authenticated;
grant select, insert, update, delete on public.business_daily_metrics, public.staff_daily_metrics to service_role;

create function private.beirut_day_start(p_day date) returns timestamptz
language sql immutable set search_path = '' as $$
  select (p_day::timestamp at time zone 'Asia/Beirut')
$$;

create function private.working_minutes(p_staff_id uuid, p_location_id uuid, p_day date) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(extract(epoch from upper(r) - lower(r)) / 60), 0)::int
  from unnest(private.staff_working_time(p_staff_id, p_location_id, p_day, p_day)) r
$$;

-- One row per location and Beirut day for [p_from, p_to] — the same query builds the stored rollups
-- and today's live numbers.
create function private.metrics_rows(p_business_id uuid, p_from date, p_to date)
returns setof public.business_daily_metrics
language sql stable security definer set search_path = '' as $$
  with days as (select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d),
  locs as (select l.id as location_id from public.business_locations l where l.business_id = p_business_id),
  bk as (
    select b.id, b.location_id, b.status, b.source, b.business_customer_id, b.starts_at, b.is_late_cancel,
           b.cancelled_by_kind, b.confirmed_at, b.is_request, b.total_price_min,
           coalesce(b.total_price_max, b.total_price_min) as price_max,
           (b.starts_at at time zone 'Asia/Beirut')::date as day,
           (b.created_at at time zone 'Asia/Beirut')::date as cday
    from public.bookings b
    where b.business_id = p_business_id and b.status <> 'held'
      and ((b.starts_at >= private.beirut_day_start(p_from) and b.starts_at < private.beirut_day_start(p_to + 1))
        or (b.created_at >= private.beirut_day_start(p_from) and b.created_at < private.beirut_day_start(p_to + 1)))
  ),
  firsts as (
    select b.business_customer_id, min(b.starts_at) as first_at
    from public.bookings b
    where b.business_id = p_business_id and b.status = 'completed' and b.business_customer_id is not null
    group by b.business_customer_id
  )
  select p_business_id, l.location_id, d.day,
         coalesce(c.created, 0), coalesce(a.completed, 0), coalesce(a.rev_min, 0), coalesce(a.rev_max, 0),
         coalesce(a.cx_customer, 0), coalesce(a.cx_business, 0), coalesce(a.late, 0), coalesce(a.no_shows, 0),
         coalesce(a.new_customers, 0), coalesce(a.returning, 0), coalesce(m.booked, 0),
         coalesce((select sum(private.working_minutes(sl.staff_id, sl.location_id, d.day))::int
                   from public.staff_locations sl join public.staff_members s on s.id = sl.staff_id
                   where sl.location_id = l.location_id and s.status = 'active' and s.archived_at is null), 0),
         coalesce(a.src_marketplace, 0), coalesce(a.src_link, 0), coalesce(a.src_manual, 0), coalesce(a.src_rebook, 0),
         now()
  from locs l cross join days d
  left join lateral (
    select count(*) filter (where bk.status = 'completed')::int as completed,
           coalesce(sum(bk.total_price_min) filter (where bk.status = 'completed'), 0) as rev_min,
           coalesce(sum(bk.price_max) filter (where bk.status = 'completed'), 0) as rev_max,
           count(*) filter (where bk.status = 'cancelled' and bk.cancelled_by_kind = 'customer')::int as cx_customer,
           count(*) filter (where bk.status = 'cancelled' and bk.cancelled_by_kind = 'business')::int as cx_business,
           count(*) filter (where bk.status = 'cancelled' and bk.is_late_cancel)::int as late,
           count(*) filter (where bk.status = 'no_show')::int as no_shows,
           count(distinct bk.business_customer_id) filter (where bk.status = 'completed' and f.first_at = bk.starts_at)::int as new_customers,
           count(distinct bk.business_customer_id) filter (where bk.status = 'completed' and f.first_at < bk.starts_at)::int as returning,
           count(*) filter (where bk.status = 'completed' and bk.source::text like 'marketplace%')::int as src_marketplace,
           count(*) filter (where bk.status = 'completed' and bk.source = 'business_link')::int as src_link,
           count(*) filter (where bk.status = 'completed' and bk.source in ('manual', 'walk_in'))::int as src_manual,
           count(*) filter (where bk.status = 'completed' and bk.source = 'rebook')::int as src_rebook
    from bk left join firsts f on f.business_customer_id = bk.business_customer_id
    where bk.location_id = l.location_id and bk.day = d.day
  ) a on true
  left join lateral (
    select count(*)::int as created from bk
    where bk.location_id = l.location_id and bk.cday = d.day and (bk.confirmed_at is not null or bk.is_request)
  ) c on true
  left join lateral (
    select sum(i.duration_min)::int as booked
    from bk join public.booking_items i on i.booking_id = bk.id
    where bk.location_id = l.location_id and bk.day = d.day and bk.status in ('confirmed', 'completed') and i.blocks_time
  ) m on true
$$;

create function private.staff_metrics_rows(p_business_id uuid, p_from date, p_to date)
returns setof public.staff_daily_metrics
language sql stable security definer set search_path = '' as $$
  with days as (select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d),
  staff as (select s.id from public.staff_members s where s.business_id = p_business_id),
  it as (
    select i.staff_id, (b.starts_at at time zone 'Asia/Beirut')::date as day, b.status, i.price_min,
           i.duration_min, i.blocks_time, i.requested_staff_id
    from public.booking_items i join public.bookings b on b.id = i.booking_id
    where i.business_id = p_business_id and b.status in ('confirmed', 'completed', 'no_show')
      and b.starts_at >= private.beirut_day_start(p_from) and b.starts_at < private.beirut_day_start(p_to + 1)
  )
  select s.id, p_business_id, d.day,
         coalesce(a.completed, 0), coalesce(a.rev, 0), coalesce(a.booked, 0),
         coalesce((select sum(private.working_minutes(sl.staff_id, sl.location_id, d.day))::int
                   from public.staff_locations sl where sl.staff_id = s.id), 0),
         coalesce(a.requested, 0), coalesce(a.no_shows, 0), now()
  from staff s cross join days d
  left join lateral (
    select count(*) filter (where it.status = 'completed')::int as completed,
           coalesce(sum(it.price_min) filter (where it.status = 'completed'), 0) as rev,
           coalesce(sum(it.duration_min) filter (where it.status in ('confirmed', 'completed') and it.blocks_time), 0)::int as booked,
           count(*) filter (where it.requested_staff_id = s.id and it.status <> 'no_show')::int as requested,
           count(*) filter (where it.status = 'no_show')::int as no_shows
    from it where it.staff_id = s.id and it.day = d.day
  ) a on true
$$;

-- Rebuild [p_from, p_to] for every business past draft. Idempotent (delete + insert per range).
create function private.refresh_daily_metrics(p_from date, p_to date) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  delete from public.business_daily_metrics where day between p_from and p_to;
  delete from public.staff_daily_metrics where day between p_from and p_to;
  insert into public.business_daily_metrics
  select m.* from public.businesses b cross join lateral private.metrics_rows(b.id, p_from, p_to) m
  where b.status <> 'draft';
  get diagnostics n = row_count;
  insert into public.staff_daily_metrics
  select m.* from public.businesses b cross join lateral private.staff_metrics_rows(b.id, p_from, p_to) m
  where b.status <> 'draft';
  return n;
end $$;

create function private.job_daily_metrics() returns int
language sql volatile security definer set search_path = '' as $$
  select private.refresh_daily_metrics(((now() at time zone 'Asia/Beirut')::date - 7), ((now() at time zone 'Asia/Beirut')::date - 1))
$$;

-- B11: headline KPIs vs the previous period, daily trend, top services, staff table, source mix.
-- Stored rollups for past days + a live computation for today. Owner / manager see revenue;
-- reception sees counts only; staff have no access.
create function public.biz_get_analytics(p_business_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.business_role := private.my_role(p_business_id);
  v_money boolean;
  v_today date := (now() at time zone 'Asia/Beirut')::date;
  v_len int;
  v_prev_from date;
  v_prev_to date;
  v jsonb;
begin
  if v_role is null or v_role not in ('owner', 'manager', 'reception') then perform private.raise_code('FORBIDDEN'); end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    perform private.raise_code('INVALID_INPUT', '{"field":"period"}');
  end if;
  v_money := v_role in ('owner', 'manager');
  v_len := p_to - p_from + 1;
  v_prev_to := p_from - 1;
  v_prev_from := p_from - v_len;

  with rows as (
    select * from public.business_daily_metrics m
    where m.business_id = p_business_id and m.day between v_prev_from and least(p_to, v_today - 1)
    union all
    select * from private.metrics_rows(p_business_id, v_today, v_today) t where v_today between v_prev_from and p_to
  ),
  cur as (select * from rows where day between p_from and p_to),
  prev as (select * from rows where day between v_prev_from and v_prev_to),
  tot as (
    select 'cur' as k, sum(bookings_created) created, sum(bookings_completed) completed, sum(revenue_min) rev_min,
           sum(revenue_max) rev_max, sum(cancellations_customer + cancellations_business) cancelled, sum(no_shows) no_shows,
           sum(new_customers) new_c, sum(booked_minutes) booked, sum(available_minutes) avail,
           sum(src_marketplace) s_mkt, sum(src_business_link) s_link, sum(src_manual) s_manual, sum(src_rebook) s_rebook
    from cur
    union all
    select 'prev', sum(bookings_created), sum(bookings_completed), sum(revenue_min), sum(revenue_max),
           sum(cancellations_customer + cancellations_business), sum(no_shows), sum(new_customers), sum(booked_minutes),
           sum(available_minutes), sum(src_marketplace), sum(src_business_link), sum(src_manual), sum(src_rebook)
    from prev
  ),
  uniq as (
    select count(distinct b.business_customer_id) filter (where b.starts_at >= private.beirut_day_start(p_from)) as cur_n,
           count(distinct b.business_customer_id) filter (where b.starts_at < private.beirut_day_start(p_from)) as prev_n
    from public.bookings b
    where b.business_id = p_business_id and b.status = 'completed'
      and b.starts_at >= private.beirut_day_start(v_prev_from) and b.starts_at < private.beirut_day_start(p_to + 1)
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', v_prev_from, 'prev_to', v_prev_to),
    'show_revenue', v_money,
    'enough_data', exists (select 1 from public.bookings b where b.business_id = p_business_id and b.status <> 'held'
                            and b.created_at < now() - interval '7 days'),
    'kpis', (select jsonb_object_agg(t.k, jsonb_build_object(
               'revenue_min', case when v_money then coalesce(t.rev_min, 0) end,
               'revenue_max', case when v_money then coalesce(t.rev_max, 0) end,
               'completed', coalesce(t.completed, 0),
               'created', coalesce(t.created, 0),
               'customers', case t.k when 'cur' then u.cur_n else u.prev_n end,
               'new_customers', coalesce(t.new_c, 0),
               'returning_customers', greatest(case t.k when 'cur' then u.cur_n else u.prev_n end - coalesce(t.new_c, 0), 0),
               'avg_value', case when v_money and coalesce(t.completed, 0) > 0 then round(t.rev_min / t.completed, 2) end,
               'cancellation_rate', case when coalesce(t.created, 0) > 0 then round(t.cancelled::numeric / t.created, 3) end,
               'no_show_rate', case when coalesce(t.completed, 0) + coalesce(t.no_shows, 0) > 0
                                    then round(t.no_shows::numeric / (t.completed + t.no_shows), 3) end,
               'utilization', case when coalesce(t.avail, 0) > 0 then round(t.booked::numeric / t.avail, 3) end))
             from tot t, uniq u),
    'estimated', v_money and exists (select 1 from cur where revenue_max > revenue_min),
    'series', coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'completed', s.completed,
                                 'revenue', case when v_money then s.rev end) order by s.day)
                        from (select day, sum(bookings_completed)::int completed, sum(revenue_min) rev from cur group by day) s), '[]'),
    'sources', (select jsonb_build_object('marketplace', coalesce(s_mkt, 0), 'business_link', coalesce(s_link, 0),
                                          'manual', coalesce(s_manual, 0), 'rebook', coalesce(s_rebook, 0))
                from tot where k = 'cur'),
    'services', coalesce((select jsonb_agg(x order by (x ->> 'completed')::int desc, x ->> 'name') from (
                   select jsonb_build_object('service_id', sv.id, 'name', sv.name, 'completed', count(*),
                            'revenue', case when v_money then sum(i.price_min) end) x
                   from public.booking_items i join public.bookings b on b.id = i.booking_id
                   join public.services sv on sv.id = i.service_id
                   where i.business_id = p_business_id and b.status = 'completed'
                     and b.starts_at >= private.beirut_day_start(p_from) and b.starts_at < private.beirut_day_start(p_to + 1)
                   group by sv.id, sv.name) q), '[]'),
    'staff', coalesce((select jsonb_agg(x order by (x ->> 'completed')::int desc, x ->> 'name') from (
                   select jsonb_build_object('staff_id', st.id, 'name', st.display_name, 'archived', st.archived_at is not null,
                            'completed', sum(sm.bookings_completed), 'revenue', case when v_money then sum(sm.revenue_min) end,
                            'utilization', case when sum(sm.available_minutes) > 0
                                                then round(sum(sm.booked_minutes)::numeric / sum(sm.available_minutes), 3) end,
                            'requested', sum(sm.specifically_requested), 'no_shows', sum(sm.no_shows)) x
                   from (select * from public.staff_daily_metrics m
                         where m.business_id = p_business_id and m.day between p_from and least(p_to, v_today - 1)
                         union all
                         select * from private.staff_metrics_rows(p_business_id, v_today, v_today) t where v_today between p_from and p_to) sm
                   join public.staff_members st on st.id = sm.staff_id
                   group by st.id, st.display_name, st.archived_at
                   having sum(sm.bookings_completed) > 0 or sum(sm.available_minutes) > 0 or st.archived_at is null) q), '[]')
  ) into v;
  return v;
end $$;

-- ═══ System health (ops) ════════════════════════════════════════════════════
-- pg_cron's tables only show a role its own jobs, so an app_owner function can't read them. A cron
-- statement (runs as the job owner) snapshots each job's latest run here every 5 minutes.
create table private.cron_health (
  jobname       text primary key,
  schedule      text not null,
  active        boolean not null,
  last_run_at   timestamptz,
  last_status   text,
  last_message  text,
  runs_24h      int not null default 0,
  failures_24h  int not null default 0,
  captured_at   timestamptz not null default now()
);

-- Expected run interval from the schedule: "* * * * *" → 1, "*/N ..." → N minutes, otherwise daily.
create function private.cron_interval_minutes(p_schedule text) returns int
language sql immutable set search_path = '' as $$
  select case when split_part(p_schedule, ' ', 1) = '*' and split_part(p_schedule, ' ', 2) = '*' then 1
              when split_part(p_schedule, ' ', 1) ~ '^\*/\d+$' and split_part(p_schedule, ' ', 2) = '*'
                then substr(split_part(p_schedule, ' ', 1), 3)::int
              else 1440 end
$$;

create function public.admin_system_health() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare v_jobs jsonb; v_queues jsonb; v_delivery jsonb; v_alerts jsonb := '[]'::jsonb;
begin
  perform private.admin_caller('{ops}');
  select coalesce(jsonb_agg(jsonb_build_object(
           'job', h.jobname, 'schedule', h.schedule, 'active', h.active, 'last_run_at', h.last_run_at,
           'last_status', h.last_status, 'last_message', h.last_message, 'runs_24h', h.runs_24h,
           'failures_24h', h.failures_24h, 'captured_at', h.captured_at,
           'stale', h.active and (h.last_run_at is null
                    or h.last_run_at < now() - make_interval(mins => 3 * private.cron_interval_minutes(h.schedule) + 10)),
           'failing', h.last_status = 'failed')
         order by h.jobname), '[]')
    into v_jobs from private.cron_health h;

  v_queues := jsonb_build_object(
    'notifications_overdue', (select count(*) from public.notifications where status = 'queued' and scheduled_for < now() - interval '15 minutes'),
    'notifications_processing_stuck', (select count(*) from public.notifications where status = 'processing' and scheduled_for < now() - interval '15 minutes'),
    'search_refresh', (select jsonb_build_object('count', count(*), 'oldest', min(requested_at)) from private.search_refresh_queue),
    'photos_pending_30m', (select count(*) from public.review_media where state = 'pending' and created_at < now() - interval '30 minutes'),
    'comments_pending_1h', (select count(*) from public.reviews where text_state = 'pending' and updated_at < now() - interval '1 hour'),
    'account_deletions_overdue', (select count(*) from private.account_deletions where status = 'requested' and requested_at < now() - interval '1 hour'),
    'account_deletions_need_support', (select count(*) from private.account_deletions where status = 'needs_support'),
    'health_snapshot_age_s', (select extract(epoch from now() - max(captured_at))::int from private.cron_health));

  select coalesce(jsonb_object_agg(channel, jsonb_build_object('sent', sent, 'failed', failed,
           'rate', case when sent + failed > 0 then round(sent::numeric / (sent + failed), 3) end)), '{}')
    into v_delivery
  from (select d.channel::text as channel,
               count(*) filter (where d.status in ('sent', 'delivered', 'read')) as sent,
               count(*) filter (where d.status = 'failed') as failed
        from public.notification_deliveries d where d.created_at > now() - interval '24 hours'
        group by d.channel) x;

  select coalesce(jsonb_agg(a), '[]') into v_alerts from (
    select 'job_failing' as a from jsonb_array_elements(v_jobs) j where (j ->> 'failing')::boolean
    union all select 'job_stale' from jsonb_array_elements(v_jobs) j where (j ->> 'stale')::boolean
    union all select 'no_health_snapshot' where jsonb_array_length(v_jobs) = 0
                 or coalesce((v_queues ->> 'health_snapshot_age_s')::int, 999999) > 900
    union all select 'notifications_overdue' where (v_queues ->> 'notifications_overdue')::int > 0
    union all select 'search_refresh_backlog' where (v_queues -> 'search_refresh' ->> 'count')::int > 200
    union all select 'photos_backlog' where (v_queues ->> 'photos_pending_30m')::int > 0
    union all select 'comments_backlog' where (v_queues ->> 'comments_pending_1h')::int > 0
    union all select 'account_deletions' where (v_queues ->> 'account_deletions_overdue')::int > 0
                 or (v_queues ->> 'account_deletions_need_support')::int > 0
    union all select 'whatsapp_delivery_low' where (v_delivery -> 'whatsapp' ->> 'rate')::numeric < 0.9
                 and ((v_delivery -> 'whatsapp' ->> 'sent')::int + (v_delivery -> 'whatsapp' ->> 'failed')::int) >= 20
  ) s;

  return jsonb_build_object('jobs', v_jobs, 'queues', v_queues, 'delivery_24h', v_delivery,
                            'alerts', (select coalesce(jsonb_agg(distinct a), '[]') from jsonb_array_elements_text(v_alerts) a),
                            'db_size_mb', (pg_database_size(current_database()) / 1048576)::int);
end $$;

-- Uptime monitors: proves the API and database answer (no data, anonymous).
create function public.health_ping() returns timestamptz
language sql stable security definer set search_path = '' as $$ select now() $$;

-- ═══ Grants & schedules ═════════════════════════════════════════════════════
revoke execute on function private.beirut_day_start(date), private.working_minutes(uuid, uuid, date),
  private.metrics_rows(uuid, date, date), private.staff_metrics_rows(uuid, date, date),
  private.refresh_daily_metrics(date, date), private.job_daily_metrics(), private.cron_interval_minutes(text)
  from public, anon, authenticated;
revoke execute on function public.biz_get_analytics(uuid, date, date), public.admin_system_health(), public.health_ping()
  from public;
grant execute on function public.biz_get_analytics(uuid, date, date) to authenticated, service_role;
grant execute on function public.admin_system_health() to authenticated, service_role;
grant execute on function public.health_ping() to anon, authenticated, service_role;

do $$
declare j text;
begin
  foreach j in array array['app_daily_metrics', 'app_cron_health', 'app_cron_cleanup'] loop
    perform cron.unschedule(jobid) from cron.job where jobname = j;
  end loop;
end $$;
select cron.schedule('app_daily_metrics', '45 1 * * *', 'select private.job_daily_metrics()');
select cron.schedule('app_cron_health', '*/5 * * * *', $job$
  insert into private.cron_health (jobname, schedule, active, last_run_at, last_status, last_message, runs_24h, failures_24h, captured_at)
  select j.jobname, j.schedule, j.active, r.start_time, r.status, left(r.return_message, 300),
         coalesce(f.runs, 0), coalesce(f.failed, 0), now()
  from cron.job j
  left join lateral (select d.start_time, d.status, d.return_message from cron.job_run_details d
                     where d.jobid = j.jobid order by d.start_time desc limit 1) r on true
  left join lateral (select count(*)::int as runs, count(*) filter (where d.status = 'failed')::int as failed
                     from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '24 hours') f on true
  where j.jobname like 'app\_%'
  on conflict (jobname) do update set schedule = excluded.schedule, active = excluded.active,
    last_run_at = excluded.last_run_at, last_status = excluded.last_status, last_message = excluded.last_message,
    runs_24h = excluded.runs_24h, failures_24h = excluded.failures_24h, captured_at = excluded.captured_at
$job$);
-- pg_cron keeps every run forever; a week is enough for the health view
select cron.schedule('app_cron_cleanup', '20 4 * * *', $job$ delete from cron.job_run_details where end_time < now() - interval '7 days' $job$);

select private.assign_app_ownership();

-- Backfill so B11 has history on day one (small at launch; the nightly job keeps the last 7 days fresh).
select private.refresh_daily_metrics(((now() at time zone 'Asia/Beirut')::date - 400), ((now() at time zone 'Asia/Beirut')::date - 1));
