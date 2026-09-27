-- Phase 3 Part 3 §1.6 — rate limiting
begin;
create extension if not exists pgtap with schema extensions;
-- Hosted sessions (CLI login role) do not have extensions on search_path; be explicit.
set local search_path = extensions, public;
-- Run as postgres everywhere (hosted CLI connects as a temporary login role).
set local role postgres;
select plan(5);

select lives_ok($$ select private.hit_rate_limit('otp', 'phone:+96170123456', 3, interval '10 minutes') $$, 'hit 1');
select lives_ok($$ select private.hit_rate_limit('otp', 'phone:+96170123456', 3, interval '10 minutes') $$, 'hit 2');
select lives_ok($$ select private.hit_rate_limit('otp', 'phone:+96170123456', 3, interval '10 minutes') $$, 'hit 3');
select throws_ok($$ select private.hit_rate_limit('otp', 'phone:+96170123456', 3, interval '10 minutes') $$,
  'P0001', 'RATE_LIMITED', '4th hit in the window is rejected');

-- Clients can't call it directly (only SECURITY DEFINER RPCs can)
select set_config('role', 'authenticated', true);
select throws_ok($$ select private.hit_rate_limit('otp', 'x', 3, interval '10 minutes') $$,
  '42501', null, 'authenticated cannot call hit_rate_limit directly');
set local role postgres;

select * from finish();
rollback;
