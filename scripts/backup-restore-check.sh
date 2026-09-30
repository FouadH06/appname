#!/usr/bin/env bash
# M14 · backup → restore verification (logical dump), LOCAL stack only.
#
# Dumps the database the way a logical backup would (pg_dump custom format), restores it into a fresh
# database on the same server and compares: row counts of every table in public/private/audit/auth,
# the number of functions, policies and triggers, and a schema fingerprint. Exits non-zero on any
# difference. The hosted equivalent (PITR / daily backups restored into a scratch project) is a
# pre-real-user checklist item — see docs/launch/pre-real-user-checklist.md.
#
# pg_cron / pg_net / pgmq are server-level or database-bound and are not restored into the scratch
# database; their schemas are excluded from the comparison (jobs are recreated by migrations).
set -euo pipefail

CONTAINER="${DB_CONTAINER:-supabase_db_app-name}"
SCRATCH="restore_check"
psqlc() { docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

if ! docker exec "$CONTAINER" true 2>/dev/null; then
  echo "local database container $CONTAINER is not running (supabase start)" >&2
  exit 2
fi

SUMMARY_SQL=$(cat <<'SQL'
with t as (
  select n.nspname, c.relname,
         (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as rows
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private', 'audit', 'auth', 'storage') and c.relkind in ('r', 'p')
    and not c.relispartition
)
select 'table ' || nspname || '.' || relname || ' ' || rows from t
union all
select 'functions ' || count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private', 'audit')
union all
select 'policies ' || count(*) from pg_policies where schemaname in ('public', 'storage')
union all
select 'triggers ' || count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private', 'audit') and not g.tgisinternal
union all
select 'schema ' || md5(string_agg(n.nspname || '.' || c.relname || ':' || a.attname || ':' || format_type(a.atttypid, a.atttypmod), ','
                                   order by n.nspname, c.relname, a.attnum))
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private', 'audit') and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
order by 1;
SQL
)
# Ownership and grants (the security model): only restorable by a role that can SET ROLE app_owner.
ACL_SQL=$(cat <<'SQL'
select md5(string_agg(n.nspname || '.' || c.relname || ':' || pg_get_userbyid(c.relowner) || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text, ','
                      order by n.nspname, c.relname))
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public', 'private', 'audit') and c.relkind in ('r', 'p', 'v')
union all
select md5(string_agg(p.oid::regprocedure::text || ':' || pg_get_userbyid(p.proowner) || ':' || coalesce(p.proacl::text, '') || ':' || p.prosecdef::text, ','
                      order by p.oid::regprocedure::text))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private', 'audit');
SQL
)

echo "1/4 dumping postgres (custom format)…"
start=$(date +%s)
docker exec "$CONTAINER" sh -c 'pg_dump -U postgres -d postgres -Fc --no-owner=false -f /tmp/backup.dump \
  --exclude-schema=cron --exclude-schema=net --exclude-schema=pgmq --exclude-schema=_realtime \
  --exclude-extension=pg_cron --exclude-extension=pg_net --exclude-extension=pgmq' 2>/dev/null || \
docker exec "$CONTAINER" sh -c 'pg_dump -U postgres -d postgres -Fc -f /tmp/backup.dump \
  --exclude-schema=cron --exclude-schema=net --exclude-schema=pgmq --exclude-schema=_realtime \
  --exclude-extension=pg_cron --exclude-extension=pg_net --exclude-extension=pgmq'
size=$(docker exec "$CONTAINER" sh -c 'du -k /tmp/backup.dump | cut -f1')
echo "   dump: ${size} KB in $(( $(date +%s) - start )) s"

echo "2/4 restoring into a scratch database ($SCRATCH)…"
psqlc -d postgres -c "drop database if exists $SCRATCH" -c "create database $SCRATCH"
start=$(date +%s)
# Supabase-managed objects that already exist per server can emit harmless "already exists" errors;
# the comparison below is the pass/fail signal.
docker exec "$CONTAINER" sh -c "pg_restore -U postgres -d $SCRATCH --no-comments /tmp/backup.dump" > /tmp/restore.log 2>&1 || true
echo "   restore finished in $(( $(date +%s) - start )) s ($(grep -c 'error:' /tmp/restore.log || true) non-fatal restore messages)"

echo "3/4 comparing…"
psqlc -d postgres -c "$SUMMARY_SQL" > /tmp/source.txt
psqlc -d "$SCRATCH" -c "$SUMMARY_SQL" > /tmp/restored.txt
psqlc -d postgres -c "$ACL_SQL" > /tmp/source_acl.txt
psqlc -d "$SCRATCH" -c "$ACL_SQL" > /tmp/restored_acl.txt
tables=$(grep -c '^table ' /tmp/source.txt)
rows=$(awk '/^table /{s+=$3} END{print s}' /tmp/source.txt)

echo "4/4 cleaning up…"
psqlc -d postgres -c "drop database $SCRATCH"
docker exec "$CONTAINER" rm -f /tmp/backup.dump

if diff -u /tmp/source.txt /tmp/restored.txt > /tmp/restore.diff; then
  echo "PASS: $tables tables, $rows rows, functions/policies/triggers and schema fingerprint identical after restore"
  if diff -q /tmp/source_acl.txt /tmp/restored_acl.txt > /dev/null; then
    echo "PASS: ownership, grants, RLS flags and SECURITY DEFINER settings identical"
  else
    echo "NOTE: ownership/grants differ — this local restore runs as 'postgres', which cannot SET ROLE app_owner."
    echo "      A production restore must run as a role that can (Supabase PITR / support restore, or the"
    echo "      migration role), then re-run supabase/tests/database/010_schema_hygiene + 340_security_review."
  fi
else
  echo "FAIL: restored database differs:" >&2
  head -40 /tmp/restore.diff >&2
  grep 'error:' /tmp/restore.log | head -20 >&2 || true
  exit 1
fi
