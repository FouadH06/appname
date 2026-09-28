#!/usr/bin/env python3
"""Hosted booking-engine smoke: races, non-leak, latency, residue. Staging only.

Usage (from the repo root, after `supabase login` + `supabase link` to STAGING):
  SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<publishable key> python scripts/hosted-booking-smoke.py
  ... python scripts/hosted-booking-smoke.py --cleanup-orphans   # after an interrupted run

How it works
- SQL runs through `supabase db query --linked` (the CLI's temporary login role; no DB password or
  service-role key). Calls are sequential: each one rotates that role's password, so parallel
  logins fail and trip the pooler's auth circuit breaker.
- Signed-in customers are simulated exactly as pgTAP does: `request.jwt.claims` + role
  `authenticated` inside the transaction. No accounts are created through Auth; fixture users are
  credential-less `auth.users` rows that can't sign in, deleted at the end.
- The public checks use the Data API with the publishable key only, as a logged-out browser does.
- Races run as one-shot pg_cron jobs (one backend each, no extra logins), results in a scratch
  schema `zz_smoke` that is dropped afterwards with the jobs and their run logs.
- Everything the fixture creates is deleted at the end, including the append-only rows it caused
  (booking_events, audit.entity_changes for the fixture business/users, which needs
  session_replication_role = replica for those two leaf deletes). Table counts are compared
  before/after; any difference fails the run.
"""
from __future__ import annotations

import json
import os
import random
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CLI = str(ROOT / "node_modules" / ".bin" / ("supabase.CMD" if os.name == "nt" else "supabase"))
TMP = Path(os.environ.get("TEMP", "/tmp")) / "hosted-booking-smoke"
TMP.mkdir(parents=True, exist_ok=True)

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_ANON_KEY", "")
ROUNDS = int(os.environ.get("ROUNDS", "10"))
PERF_SAMPLES = int(os.environ.get("PERF_SAMPLES", "30"))
STEP_S = 2  # seconds between race rounds
TARGET = "--local" if os.environ.get("DB_TARGET") == "local" else "--linked"  # local = rehearsal of this script

if not URL or not KEY:
    sys.exit("set SUPABASE_URL and SUPABASE_ANON_KEY (publishable key only)")
if KEY.startswith("sb_secret") or "service_role" in KEY:
    sys.exit("refusing: pass the publishable key, never a secret/service-role key")

sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to cp1252
results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}", flush=True)


# ---------------------------------------------------------------- SQL through the Management API
def q_local(sql: str, label: str) -> list[dict]:
    """Rehearsal only: `db query --local` is single-statement, so run the same script through psql in
    the local container and return the final SELECT as JSON."""
    body = sql.rstrip().rstrip(";")
    cut = body.rfind("\nselect ")
    head, final = (body[:cut], body[cut + 1:]) if cut >= 0 else ("", body)
    script = f"{head}\n;\nselect '@@' || coalesce(jsonb_agg(_r)::text, '[]') from ({final}) _r;\n"
    p = subprocess.run(["docker", "exec", "-i", "supabase_db_app-name", "psql", "-U", "postgres", "-X", "-q", "-At",
                        "-v", "ON_ERROR_STOP=1"], input=script, capture_output=True, text=True, encoding="utf-8")
    line = next((x for x in p.stdout.splitlines() if x.startswith("@@")), None)
    if p.returncode != 0 or line is None:
        raise RuntimeError(f"{label} failed:\n{p.stdout[-800:]}\n{p.stderr[-1500:]}")
    return json.loads(line[2:])


def q(sql: str, label: str = "q") -> list[dict]:
    if TARGET == "--local":
        return q_local(sql, label)
    path = TMP / f"{label}-{uuid.uuid4().hex[:8]}.sql"
    path.write_text(sql, encoding="utf-8")
    for attempt in range(3):
        p = subprocess.run([CLI, "db", "query", TARGET, "-f", str(path), "-o", "json"],
                           cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        out = p.stdout.strip()
        start = out.find("{")
        if p.returncode == 0 and start >= 0:
            path.unlink(missing_ok=True)
            return json.loads(out[start:]).get("rows", [])
        if "429" not in (p.stdout + p.stderr) or attempt == 2:
            raise RuntimeError(f"{label} failed:\n{p.stdout[-1500:]}\n{p.stderr[-1500:]}")
        time.sleep(5)
    return []


def lit(v) -> str:
    if v is None:
        return "null"
    return "'" + str(v).replace("'", "''") + "'"


def claims(uid: str) -> str:
    return json.dumps({"sub": uid, "role": "authenticated", "aal": "aal1", "is_anonymous": False})


# ---------------------------------------------------------------- Data API (publishable key only)
def api(method: str, path: str, body: dict | None = None) -> tuple[int, str, float]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", data=data, method=method, headers={
        "apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode()
            status = r.status
    except urllib.error.HTTPError as e:
        text, status = e.read().decode(), e.code
    return status, text, (time.perf_counter() - t0) * 1000


def pct(xs: list[float], p: float) -> float:
    s = sorted(xs)
    return s[min(len(s) - 1, max(0, round(p / 100 * len(s) + 0.5) - 1))]


def stats(xs: list[float]) -> dict:
    return {"p50": round(pct(xs, 50), 1), "p95": round(pct(xs, 95), 1), "max": round(max(xs), 1)}


# ---------------------------------------------------------------- residue snapshot
COUNT_TABLES = [
    "auth.users", "public.profiles", "public.businesses", "public.business_members", "public.business_locations",
    "public.location_hours", "public.services", "public.staff_members", "public.staff_locations",
    "public.staff_services", "public.staff_weekly_hours", "public.business_customers", "public.bookings",
    "public.booking_items", "public.booking_events", "private.access_tokens", "private.reliability_events",
    "private.customer_reliability", "private.rate_limits", "audit.entity_changes", "audit.admin_actions",
]


def snapshot() -> dict:
    sql = "select " + ", ".join(f"(select count(*) from {t}) as \"{t}\"" for t in COUNT_TABLES)
    return q(sql, "snapshot")[0]


# ---------------------------------------------------------------- fixture
TAG = uuid.uuid4().hex[:8]
BIZ, LOC, SVC, OWNER = (str(uuid.uuid4()) for _ in range(4))
STAFF = [str(uuid.uuid4()) for _ in range(8)]          # public + accept "any"
SENIOR = str(uuid.uuid4())                              # public, never auto-assigned
INTERNAL = str(uuid.uuid4())                            # internal-only: must never leak
USERS = [str(uuid.uuid4()) for _ in range(40 + PERF_SAMPLES)]
U21, U22, U23, U26, UPERF = USERS[0:20], USERS[20:28], USERS[28], USERS[29:29 + ROUNDS], USERS[40:]
ALL_USERS = [OWNER] + USERS

# day offsets (Beirut) per scenario, so scenarios never touch each other's slots
D21, D22, D23, D24, D26 = 2, 2 + ROUNDS, 2 + 2 * ROUNDS, 2 + 3 * ROUNDS, 2 + 4 * ROUNDS


def at(day: int, hhmm: str) -> str:
    return f"((((now() at time zone 'Asia/Beirut')::date + {day})::timestamp + time '{hhmm}') at time zone 'Asia/Beirut')"


def setup() -> None:
    rnd = random.Random(TAG)
    phones = rnd.sample(range(10_000_000), len(USERS))
    user_rows = ",\n".join(
        f"({lit(u)}, 'authenticated', 'authenticated', '9617{phones[i]:07d}', now(), now(), now())"
        for i, u in enumerate(USERS))
    staff_rows = ",\n".join(f"({lit(s)}, {lit(BIZ)}, 'Staff {i}', 'staff-{i}', true, true)" for i, s in enumerate(STAFF))
    all_staff = STAFF + [SENIOR, INTERNAL]
    sql = f"""
create schema if not exists zz_smoke;
create table if not exists zz_smoke.r (scn text, contender int, round int, t0 timestamptz, t1 timestamptz,
  outcome text, bid uuid, sid uuid, pid int);
begin;
insert into auth.users (id, aud, role, created_at, updated_at) values ({lit(OWNER)}, 'authenticated', 'authenticated', now(), now());
insert into auth.users (id, aud, role, phone, phone_confirmed_at, created_at, updated_at) values
{user_rows};
insert into public.businesses (id, slug, name, primary_category_id, status)
  select {lit(BIZ)}, 'zz-hosted-smoke-{TAG}', 'Hosted smoke {TAG}', id, 'live' from public.categories where slug = 'barber';
insert into public.business_members (business_id, user_id, role) values ({lit(BIZ)}, {lit(OWNER)}, 'owner');
update public.business_settings set min_notice_minutes = 0, max_advance_days = 90, slot_interval_minutes = 15,
       max_active_bookings_per_customer = 20 where business_id = {lit(BIZ)};
insert into public.business_locations (id, business_id, area_id, geo, status)
  select {lit(LOC)}, {lit(BIZ)}, id, centroid, 'live' from public.areas where slug = 'hazmieh';
insert into public.location_hours (location_id, business_id, iso_weekday, start_minute, end_minute)
  select {lit(LOC)}, {lit(BIZ)}, d, 0, 1440 from generate_series(1, 7) d;
insert into public.services (id, business_id, canonical_service_id, name, price_type, price_min, duration_min)
  select {lit(SVC)}, {lit(BIZ)}, id, 'Haircut', 'fixed', 15, 30 from public.canonical_services where slug = 'mens-haircut';
insert into public.staff_members (id, business_id, display_name, slug, publicly_bookable, accepts_any_assignment) values
{staff_rows},
({lit(SENIOR)}, {lit(BIZ)}, 'Senior Stylist', 'senior', true, false),
({lit(INTERNAL)}, {lit(BIZ)}, 'Internal Only', 'internal', false, false);
insert into public.staff_locations (staff_id, location_id, business_id)
  select s, {lit(LOC)}, {lit(BIZ)} from unnest(array[{",".join(lit(s) for s in all_staff)}]::uuid[]) s;
insert into public.staff_services (staff_id, service_id, business_id)
  select s, {lit(SVC)}, {lit(BIZ)} from unnest(array[{",".join(lit(s) for s in all_staff)}]::uuid[]) s;
insert into public.staff_weekly_hours (staff_id, location_id, business_id, iso_weekday, start_minute, end_minute, effective_from)
  select s, {lit(LOC)}, {lit(BIZ)}, d, 0, 1440, current_date - 1
  from unnest(array[{",".join(lit(s) for s in all_staff)}]::uuid[]) s cross join generate_series(1, 7) d;

-- Perf load (Spike S4): each of the 8 staff has four 30-min bookings a day for 60 days = 1,920.
-- #22: staff 3–7 also busy at 12:00 on the #22 days, leaving exactly three free (0, 1, 2).
-- #24: staff 1 has bookings at 18:00 and 19:00 on the #24 days, both to be moved to 20:00.
with cust as (
  insert into public.business_customers (business_id, display_name, acquired_via)
  values ({lit(BIZ)}, 'Smoke customer', 'manual') returning id
), want as (
  select st.sid as sid, (((now() at time zone 'Asia/Beirut')::date + d)::timestamp + make_interval(hours => h)) at time zone 'Asia/Beirut' as t
  from unnest(array[{",".join(lit(s) for s in STAFF)}]::uuid[]) st(sid) cross join generate_series(1, 60) d cross join unnest(array[9, 11, 14, 16]) h
  union all
  select st.sid, (((now() at time zone 'Asia/Beirut')::date + d)::timestamp + time '12:00') at time zone 'Asia/Beirut'
  from unnest(array[{",".join(lit(s) for s in STAFF[3:])}]::uuid[]) st(sid) cross join generate_series({D22}, {D22 + ROUNDS - 1}) d
  union all
  select {lit(STAFF[1])}::uuid, (((now() at time zone 'Asia/Beirut')::date + d)::timestamp + make_interval(hours => h)) at time zone 'Asia/Beirut'
  from generate_series({D24}, {D24 + ROUNDS - 1}) d cross join unnest(array[18, 19]) h
), b as (
  insert into public.bookings (business_id, location_id, business_customer_id, status, source, starts_at, ends_at,
                               created_by_kind, confirmed_at, internal_note)
  select {lit(BIZ)}, {lit(LOC)}, (select id from cust), 'confirmed', 'manual', w.t, w.t + interval '30 minutes',
         'business', now(), w.sid::text
  from want w
  returning id, starts_at, ends_at, internal_note
)
insert into public.booking_items (booking_id, business_id, location_id, service_id, canonical_service_id, staff_id,
                                  selection_mode, starts_at, ends_at, occupied, duration_min, price_type, price_min)
select b.id, {lit(BIZ)}, {lit(LOC)}, {lit(SVC)}, (select canonical_service_id from public.services where id = {lit(SVC)}),
       b.internal_note::uuid, 'business', b.starts_at, b.ends_at, tstzrange(b.starts_at, b.ends_at, '[)'), 30, 'fixed', 15
from b;
update public.bookings set internal_note = null where business_id = {lit(BIZ)};
commit;
analyze public.bookings; analyze public.booking_items;
select count(*)::int as n from public.booking_items where business_id = {lit(BIZ)};
"""
    n = q(sql, "setup")[0]["n"]
    record("fixture created (8 staff + senior + internal-only, 1,920 perf bookings)", n >= 1920, f"items={n}")


def cleanup(biz: str | None = None, user_ids: list[str] | None = None) -> None:
    biz = biz or BIZ
    users = ",".join(lit(u) for u in (user_ids if user_ids is not None else ALL_USERS)) or "null"
    BIZ_ = biz
    q(f"""
begin;
-- append-only leaf rows caused by the fixture (immutability triggers are bypassed for these two deletes only)
set local session_replication_role = replica;
delete from public.booking_events where booking_id in (select id from public.bookings where business_id = {lit(BIZ_)});
set local session_replication_role = origin;
-- break the bookings <-> business_customers.first_booking_id cycle, then delete every row tagged
-- with the fixture business, retrying until foreign keys are satisfied (children first)
update public.business_customers set first_booking_id = null where business_id = {lit(BIZ_)};
do $$ declare t record; blocked int; pass int := 0; begin
  loop
    blocked := 0; pass := pass + 1;
    for t in select c.table_schema, c.table_name from information_schema.columns c
             join information_schema.tables tb using (table_schema, table_name)
             where c.column_name = 'business_id' and c.table_schema in ('public', 'private')
               and tb.table_type = 'BASE TABLE' and c.table_name not in ('businesses', 'booking_events') loop
      begin
        execute format('delete from %I.%I where business_id = $1', t.table_schema, t.table_name) using {lit(BIZ_)}::uuid;
      exception when foreign_key_violation then blocked := blocked + 1;
      end;
    end loop;
    exit when blocked = 0;
    if pass > 12 then raise exception 'cleanup: could not order deletes'; end if;
  end loop;
end $$;
delete from public.businesses where id = {lit(BIZ_)};
delete from private.rate_limits where subject in ({users});
delete from auth.users where id in ({users});
set local session_replication_role = replica;
delete from audit.entity_changes where business_id = {lit(BIZ_)} or row_id in ({users}, {lit(BIZ_)});
set local session_replication_role = origin;
commit;
-- race scaffolding: leftover one-shot jobs, their run logs, the scratch results schema
select cron.unschedule(jobid) from cron.job where jobname like 'zz_smoke_%';
delete from cron.job_run_details where command like '%zz_smoke%';
drop schema if exists zz_smoke cascade;
select 1 as ok;
""", "cleanup")


# ---------------------------------------------------------------- races
def contender_sql(job: str, scn: str, idx: int, t0: str, calls: list[tuple[str, str]]) -> str:
    """One contender, run as a one-shot pg_cron job (its own backend session).
    calls: (uid, plpgsql statement that selects `bid, sid` INTO v), one per round."""
    parts = [f"select cron.unschedule({lit(job)});"]  # one-shot: the job removes itself first
    for k, (uid, call) in enumerate(calls):
        parts.append(f"""
select pg_sleep_until(timestamptz {lit(t0)} + interval '{k * STEP_S} seconds');
begin;
do $c$ declare v record; t timestamptz := clock_timestamp(); begin
  perform set_config('request.jwt.claims', {lit(claims(uid))}, true);
  perform set_config('role', 'authenticated', true);
  begin
    {call}
    perform set_config('role', 'postgres', true);
    insert into zz_smoke.r values ({lit(scn)}, {idx}, {k}, t, clock_timestamp(), 'ok', v.bid, v.sid, pg_backend_pid());
  exception when others then
    perform set_config('role', 'postgres', true);
    insert into zz_smoke.r values ({lit(scn)}, {idx}, {k}, t, clock_timestamp(), sqlerrm, null, null, pg_backend_pid());
  end;
end $c$;
commit;""")
    return "\n".join(parts)


def race(name: str, per_contender: list[list[tuple[str, str]]]) -> list[list[dict]]:
    """Runs N contenders as parallel sessions; returns rows per round: [round][contender].

    Contenders are one-shot pg_cron jobs, so each gets its own backend with no extra logins (the
    linked CLI rotates a temporary login role per call, and parallel logins trip the pooler's auth
    circuit breaker). All contenders sleep until the same server timestamp, then act."""
    scn = "r" + "".join(ch for ch in name if ch.isalnum())
    n, rounds_n = len(per_contender), len(per_contender[0])
    t0 = q("select (now() + interval '15 seconds')::text as t", "clock")[0]["t"]
    sched = []
    for i, c in enumerate(per_contender):
        job = f"zz_smoke_{TAG}_{scn}_{i}"
        sched.append(f"select cron.schedule({lit(job)}, '1 seconds', $cmd${contender_sql(job, scn, i, t0, c)}$cmd$);")
    q("\n".join(sched) + "\nselect 1 as ok;", f"schedule-{scn}")
    deadline = time.time() + 15 + rounds_n * STEP_S + 90
    while True:
        time.sleep(5)
        got = q(f"select count(*)::int as n from zz_smoke.r where scn = {lit(scn)}", "poll")[0]["n"]
        if got >= n * rounds_n:
            break
        if time.time() > deadline:
            raise RuntimeError(f"{name}: only {got}/{n * rounds_n} results arrived")
    rows = q(f"""select contender, round, outcome, bid, sid, pid, (extract(epoch from t0) * 1000)::float8 as t0_ms
                 from zz_smoke.r where scn = {lit(scn)} order by round, contender""", f"results-{scn}")
    rounds = [[r for r in rows if r["round"] == k] for k in range(rounds_n)]
    spread = max(max(r["t0_ms"] for r in rnd) - min(r["t0_ms"] for r in rnd) for rnd in rounds)
    pids = len({r["pid"] for r in rows})
    print(f"      {name}: {n} parallel sessions ({pids} distinct backends) × {rounds_n} rounds, max start spread {spread:.1f} ms")
    return rounds


def hold_call(start_sql: str, staff: str | None) -> str:
    s = lit(staff) + "::uuid" if staff else "null"
    return f"select h.booking_id as bid, h.staff_id as sid into strict v from public.create_hold({lit(LOC)}, {lit(SVC)}, {start_sql}, {s}) h;"


def races() -> None:
    # #21: 20 parallel holds for one staff member and one slot → exactly one winner per round
    rounds = race("#21", [[(u, hold_call(at(D21 + k, '10:00'), STAFF[0])) for k in range(ROUNDS)] for u in U21])
    bad = [k for k, r in enumerate(rounds) if sum(x["outcome"] == "ok" for x in r) != 1]
    losers = {x["outcome"] for r in rounds for x in r if x["outcome"] != "ok"}
    record("#21 20 parallel holds, one staff → exactly one winner", not bad,
           f"{ROUNDS - len(bad)}/{ROUNDS} rounds; loser codes {sorted(losers)}")

    # #22: "Any", 3 free staff, 8 parallel holds → exactly 3 winners on 3 distinct eligible staff
    rounds = race("#22", [[(u, hold_call(at(D22 + k, '12:00'), None)) for k in range(ROUNDS)] for u in U22])
    ok_rounds = 0
    for r in rounds:
        wins = [x["sid"] for x in r if x["outcome"] == "ok"]
        ok_rounds += len(wins) == 3 and len(set(wins)) == 3 and set(wins) <= set(STAFF[:3])
    record("#22 Any, 3 free staff, 8 parallel holds → 3 winners, 3 distinct staff (never senior/internal)",
           ok_rounds == ROUNDS, f"{ok_rounds}/{ROUNDS} rounds")

    # #23: manual booking (owner) vs online hold, same staff/time → exactly one
    online = [(U23, hold_call(at(D23 + k, '10:00'), STAFF[0])) for k in range(ROUNDS)]
    manual = [(OWNER, f"select b.id as bid, null::uuid as sid into strict v from public.create_manual_booking({lit(LOC)}, "
                      f"'{{\"phone\":\"+9617100{k:04d}\",\"name\":\"Walk-in\"}}'::jsonb, {lit(SVC)}, {lit(STAFF[0])}::uuid, {at(D23 + k, '10:00')}) b;")
              for k in range(ROUNDS)]
    rounds = race("#23", [online, manual])
    bad = [k for k, r in enumerate(rounds) if sum(x["outcome"] == "ok" for x in r) != 1]
    record("#23 manual booking vs online hold, same staff/time → exactly one", not bad, f"{ROUNDS - len(bad)}/{ROUNDS} rounds")

    # #24: two parallel reschedules into one slot → exactly one
    ids = q(f"""select to_char(b.starts_at at time zone 'Asia/Beirut', 'YYYY-MM-DD HH24') as k, b.id
               from public.bookings b join public.booking_items i on i.booking_id = b.id
               where b.business_id = {lit(BIZ)} and i.staff_id = {lit(STAFF[1])}
                 and extract(hour from b.starts_at at time zone 'Asia/Beirut') in (18, 19)""", "r24")
    by = {r["k"]: r["id"] for r in ids}
    days = q(f"select to_char((now() at time zone 'Asia/Beirut')::date + d, 'YYYY-MM-DD') as d from generate_series({D24}, {D24 + ROUNDS - 1}) d order by d", "r24d")
    contenders = [[(OWNER, f"select b.id as bid, null::uuid as sid into strict v from public.biz_reschedule_booking({lit(by[d['d'] + ' ' + h])}, {at(D24 + k, '20:00')}) b;")
                   for k, d in enumerate(days)] for h in ("18", "19")]
    rounds = race("#24", contenders)
    bad = [k for k, r in enumerate(rounds) if sum(x["outcome"] == "ok" for x in r) != 1]
    record("#24 two parallel reschedules into one slot → exactly one", not bad, f"{ROUNDS - len(bad)}/{ROUNDS} rounds")

    # #26: 5 parallel confirm retries with the same idempotency key → all return the same booking
    holds = []
    for k, u in enumerate(U26):
        rows = q(f"""create temp table h (booking_id text, hold_token text);
begin;
do $$ declare v record; begin
  perform set_config('request.jwt.claims', {lit(claims(u))}, true);
  perform set_config('role', 'authenticated', true);
  select * into strict v from public.create_hold({lit(LOC)}, {lit(SVC)}, {at(D26 + k, '10:00')}, {lit(STAFF[2])}::uuid);
  perform set_config('role', 'postgres', true);
  insert into pg_temp.h values (v.booking_id, v.hold_token);
end $$;
commit;
select * from h;""", "r26h")
        holds.append(rows[0])
    contenders = [[(U26[k], f"select (public.confirm_booking({lit(h['booking_id'])}, {lit(h['hold_token'])}, 'Smoke', null, null, 'key-{TAG}-{k}')).id as bid, null::uuid as sid into strict v;")
                   for k, h in enumerate(holds)] for _ in range(5)]
    rounds = race("#26", contenders)
    ok_rounds = sum(all(x["outcome"] == "ok" for x in r) and len({x["bid"] for x in r}) == 1
                    and r[0]["bid"] == holds[k]["booking_id"] for k, r in enumerate(rounds))
    record("#26 5 parallel confirm retries, same idempotency key → same booking", ok_rounds == ROUNDS, f"{ok_rounds}/{ROUNDS} rounds")

    rows = q(f"""select
      (select count(*) from public.booking_items a join public.booking_items b on a.staff_id = b.staff_id and a.id < b.id
        where a.business_id = {lit(BIZ)} and a.blocks_time and b.blocks_time and not a.allow_overlap and not b.allow_overlap
          and a.occupied && b.occupied)::int as overlaps,
      (select count(*) from public.booking_items where business_id = {lit(BIZ)} and staff_id is null)::int as null_staff""", "overlaps")[0]
    record("no overlapping staff time, no null staff after all races", rows["overlaps"] == 0 and rows["null_staff"] == 0, json.dumps(rows))


# ---------------------------------------------------------------- non-leak (logged-out Data API)
def non_leak() -> None:
    day = q(f"select ((now() at time zone 'Asia/Beirut')::date + 70)::text as d", "day")[0]["d"]
    s, body, _ = api("POST", "rpc/get_available_slots", {"p_location_id": LOC, "p_service_id": SVC, "p_date_from": day, "p_date_to": day})
    rows = json.loads(body) if s == 200 else []
    keys = set().union(*(r.keys() for r in rows)) if rows else set()
    all_ids = STAFF + [SENIOR, INTERNAL]
    record("anon Any-mode slots: returned, no staff identifiers in the response",
           s == 200 and len(rows) > 0 and keys <= {"slot_start", "price_type", "price_min", "price_max"} and not any(i in body for i in all_ids),
           f"{s}, {len(rows)} slots, keys {sorted(keys)}")
    s, body, _ = api("POST", "rpc/get_available_slots", {"p_location_id": LOC, "p_service_id": SVC, "p_staff_id": INTERNAL, "p_date_from": day, "p_date_to": day})
    record("anon slots for an internal-only staff id → nothing", (s == 200 and json.loads(body) == []) or s >= 400, f"{s} {body[:80]}")
    s, body, _ = api("POST", "rpc/get_next_available", {"p_location_id": LOC, "p_service_id": SVC, "p_staff_id": INTERNAL})
    record("anon next-available for internal-only staff → null", (s == 200 and body.strip() == "null") or s >= 400, f"{s} {body[:80]}")
    s, body, _ = api("POST", "rpc/get_available_slots", {"p_location_id": LOC, "p_service_id": SVC, "p_staff_id": SENIOR, "p_date_from": day, "p_date_to": day})
    record("anon slots for a public staff member (control) → returned", s == 200 and len(json.loads(body)) > 0, f"{s}")
    s, body, _ = api("GET", f"staff_members?select=id,display_name&business_id=eq.{BIZ}")
    record("anon staff listing never includes the internal-only member", INTERNAL not in body, f"{s} {body[:80]}")
    s, body, _ = api("POST", "rpc/biz_get_available_slots", {"p_location_id": LOC, "p_service_id": SVC})
    record("anon business availability RPC denied", s >= 400 and INTERNAL not in body, f"{s} {body[:80]}")
    s, body, _ = api("POST", "rpc/create_hold", {"p_location_id": LOC, "p_service_id": SVC, "p_start": "2030-01-01T10:00:00Z"})
    record("anon create_hold rejected", s >= 400, f"{s} {body[:80]}")
    for t in ("bookings", "booking_items", "booking_events"):
        s, body, _ = api("GET", f"{t}?select=*&limit=1")
        record(f"anon cannot read {t}", s in (401, 403) or (s == 200 and body.strip() == "[]"), f"{s} {body[:60]}")
    s, body, _ = api("POST", "rpc/lock_staff", {"p_staff_id": STAFF[0]})
    record("private booking helpers not exposed", s in (404, 406) or s >= 400, f"{s}")


# ---------------------------------------------------------------- performance
def perf() -> dict:
    users = "array[" + ",".join(lit(u) for u in UPERF) + "]::uuid[]"
    rows = q(f"""
create temp table perf (fn text, ms float8);
do $$
declare
  us uuid[] := {users}; slot_ms float8[] := '{{}}'; hold_ms float8[] := '{{}}'; conf_ms float8[] := '{{}}';
  t timestamptz; h record;
begin
  begin  -- all work below is rolled back; only the timings survive (plpgsql variables)
    for i in 1 .. array_length(us, 1) loop
      perform set_config('request.jwt.claims', json_build_object('sub', us[i], 'role', 'authenticated', 'aal', 'aal1')::text, true);
      perform set_config('role', 'authenticated', true);
      t := clock_timestamp();
      perform count(*) from public.get_available_slots({lit(LOC)}, {lit(SVC)}, null, current_date + 1, current_date + 14);
      slot_ms := slot_ms || extract(epoch from clock_timestamp() - t) * 1000;
      t := clock_timestamp();
      select * into strict h from public.create_hold({lit(LOC)}, {lit(SVC)},
        (((now() at time zone 'Asia/Beirut')::date + 1 + (i % 50))::timestamp + time '13:00') at time zone 'Asia/Beirut');
      hold_ms := hold_ms || extract(epoch from clock_timestamp() - t) * 1000;
      t := clock_timestamp();
      perform public.confirm_booking(h.booking_id, h.hold_token, 'Perf', null, null, 'perf-' || i);
      conf_ms := conf_ms || extract(epoch from clock_timestamp() - t) * 1000;
      perform set_config('role', 'postgres', true);
    end loop;
    raise exception 'perf-rollback';
  exception when raise_exception then
    if sqlerrm <> 'perf-rollback' then raise; end if;
  end;
  perform set_config('role', 'postgres', true);
  insert into perf select 'slots', unnest(slot_ms);
  insert into perf select 'hold', unnest(hold_ms);
  insert into perf select 'confirm', unnest(conf_ms);
end $$;
select fn, array_agg(ms order by ms) as ms from perf group by fn;
""", "perf")
    db = {r["fn"]: [float(x) for x in r["ms"]] for r in rows}
    record("hosted perf samples collected (rolled back, no residue)", all(len(db.get(k, [])) == len(UPERF) for k in ("slots", "hold", "confirm")),
           f"{len(UPERF)} each")

    # Real round trips through the Data API from this machine (logged out, publishable key)
    w = q("select (current_date + 1)::text as a, (current_date + 14)::text as b", "window")[0]
    trip_slots, trip_base, trip_rpc = [], [], []
    for _ in range(PERF_SAMPLES):
        s, _, ms = api("POST", "rpc/get_available_slots", {"p_location_id": LOC, "p_service_id": SVC, "p_date_from": w["a"], "p_date_to": w["b"]})
        trip_slots.append(ms) if s == 200 else None
        _, _, ms = api("GET", "canonical_services?select=slug&limit=1")
        trip_base.append(ms)
        _, _, ms = api("POST", "rpc/create_hold", {"p_location_id": LOC, "p_service_id": SVC, "p_start": "2030-01-01T10:00:00Z"})
        trip_rpc.append(ms)
    report = {
        "db_ms": {"get_available_slots_14d_any": stats(db["slots"]), "create_hold": stats(db["hold"]),
                  "confirm_booking": stats(db["confirm"])},
        "round_trip_ms": {"get_available_slots_14d_any (anon Data API)": stats(trip_slots),
                          "baseline tiny table read (Data API)": stats(trip_base),
                          "rpc rejected by grants (anon create_hold)": stats(trip_rpc)},
    }
    print("PERF", json.dumps(report, indent=1))
    record("Gate A: p95 get_available_slots db time < 150 ms", pct(db["slots"], 95) < 150, f"{pct(db['slots'], 95):.1f} ms")
    record("Gate A: p95 create_hold db time < 100 ms", pct(db["hold"], 95) < 100, f"{pct(db['hold'], 95):.1f} ms")
    record("p95 confirm_booking db time < 100 ms", pct(db["confirm"], 95) < 100, f"{pct(db['confirm'], 95):.1f} ms")
    return report


# ---------------------------------------------------------------- main
def cleanup_orphans() -> int:
    """Recovery after an interrupted run (crash, power cut): removes every fixture business
    (slug zz-hosted-smoke-*) and the credential-less users created within 10 minutes of it."""
    found = q("""select b.id::text as biz,
                        coalesce((select json_agg(u.id) from auth.users u
                                  where u.email is null and u.encrypted_password is null
                                    and u.created_at between b.created_at - interval '10 minutes'
                                                         and b.created_at + interval '10 minutes'), '[]') as users
                 from public.businesses b where b.slug like 'zz-hosted-smoke-%'""", "orphans")
    for f in found:
        users = f["users"] if isinstance(f["users"], list) else json.loads(f["users"])
        print(f"cleaning orphaned fixture {f['biz']} with {len(users)} users")
        cleanup(f["biz"], users)
    if not found:
        cleanup("00000000-0000-0000-0000-000000000000", [])  # still clears race scaffolding
    left = q("""select (select count(*) from public.businesses where slug like 'zz-hosted-smoke-%')::int as fixtures,
                       (select count(*) from cron.job where jobname like 'zz_smoke_%')::int as jobs,
                       (select count(*) from cron.job_run_details where command like '%zz_smoke%')::int as run_logs,
                       (select count(*) from pg_namespace where nspname = 'zz_smoke')::int as schema""", "orphans-left")[0]
    print("left:", json.dumps(left))
    return 1 if any(left.values()) else 0


def main() -> int:
    if "--cleanup-orphans" in sys.argv:
        return cleanup_orphans()
    before = snapshot()
    print("snapshot before:", json.dumps(before))
    try:
        setup()
        races()
        non_leak()
        perf()
    finally:
        cleanup()
        time.sleep(2)
        after = snapshot()
        diff = {k: (before[k], after[k]) for k in before if before[k] != after[k]}
        record("no residue: every table count equals the pre-run snapshot", not diff, json.dumps(diff) if diff else "")
        left = q("""select (select count(*) from cron.job where jobname like 'zz_smoke_%')::int as jobs,
                           (select count(*) from cron.job_run_details where command like '%zz_smoke%')::int as run_logs,
                           (select count(*) from pg_namespace where nspname = 'zz_smoke')::int as schema""", "scaffold")[0]
        record("no race scaffolding left (cron jobs, run logs, scratch schema)", not any(left.values()), json.dumps(left))
    failed = [r for r in results if not r[1]]
    print(f"== {len(results) - len(failed)} passed, {len(failed)} failed ==")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
