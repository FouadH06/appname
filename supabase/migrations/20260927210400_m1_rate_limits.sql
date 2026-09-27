-- M1 · Rate limiting
-- Spec: Phase 3 Part 3 §1.6

create table private.rate_limits (
  bucket        text not null,         -- 'create_hold', 'otp', 'submit_review', 'upload'
  subject       text not null,         -- user id / ip hash / phone
  window_start  timestamptz not null,
  hits          int not null default 1,
  primary key (bucket, subject, window_start)
);

-- Fixed-window counter. Raises P0001 'RATE_LIMITED' when the window is exhausted.
-- Called from SECURITY DEFINER RPCs (never directly by clients).
create function private.hit_rate_limit(p_bucket text, p_subject text, p_max_hits int, p_window interval)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_window_start timestamptz :=
    to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window));
  v_hits int;
begin
  insert into private.rate_limits as rl (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, v_window_start, 1)
  on conflict (bucket, subject, window_start) do update set hits = rl.hits + 1
  returning hits into v_hits;

  if v_hits > p_max_hits then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED',
      detail = jsonb_build_object('bucket', p_bucket,
                                  'retry_after_seconds',
                                  ceil(extract(epoch from (v_window_start + p_window - now()))))::text;
  end if;
end $$;

revoke execute on function private.hit_rate_limit(text, text, int, interval) from public;

-- Old windows are removed by the nightly job (M3). Index supports that cleanup.
create index on private.rate_limits (window_start);

select private.assign_app_ownership();
