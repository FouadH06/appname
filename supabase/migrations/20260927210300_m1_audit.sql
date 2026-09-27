-- M1 · Audit framework (append-only)
-- Spec: Phase 3 Part 5 §8, Part 6 §4 (immutability), Part 1 P13

create table audit.admin_actions (
  id              bigint generated always as identity primary key,
  actor_user_id   uuid not null,
  actor_role      public.admin_role not null,
  action          text not null,              -- 'moderation.decide', 'business.suspend', ...
  subject_type    text not null,
  subject_id      uuid,
  business_id     uuid,
  reason_code     text not null,
  note            text,
  before          jsonb,
  after           jsonb,
  ip_hash         text,
  user_agent      text,
  created_at      timestamptz not null default now()
);
create index on audit.admin_actions (subject_type, subject_id, created_at desc);
create index on audit.admin_actions (actor_user_id, created_at desc);
create index on audit.admin_actions (business_id, created_at desc);

create table audit.entity_changes (
  id             bigint generated always as identity primary key,
  table_name     text not null,
  row_id         uuid not null,
  business_id    uuid,
  actor_user_id  uuid,                          -- auth.uid() at time of change (null = system/service)
  actor_kind     public.actor_kind not null,
  op             text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  changed        jsonb not null,                -- INSERT/DELETE: full row · UPDATE: {"col": [old, new]}
  created_at     timestamptz not null default now()
);
create index on audit.entity_changes (table_name, row_id, created_at desc);
create index on audit.entity_changes (business_id, created_at desc);

-- ─── Immutability ──────────────────────────────────────────────────────────
-- Triggers fire for every role, including superusers and service_role.
create function audit.deny_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit rows are immutable (% on %.%)', tg_op, tg_table_schema, tg_table_name
    using errcode = 'P0001';
end $$;

create trigger admin_actions_immutable before update or delete on audit.admin_actions
  for each row execute function audit.deny_mutation();
create trigger admin_actions_no_truncate before truncate on audit.admin_actions
  for each statement execute function audit.deny_mutation();
create trigger entity_changes_immutable before update or delete on audit.entity_changes
  for each row execute function audit.deny_mutation();
create trigger entity_changes_no_truncate before truncate on audit.entity_changes
  for each statement execute function audit.deny_mutation();

revoke all on all tables in schema audit from public, anon, authenticated, service_role;

-- ─── Generic change capture ────────────────────────────────────────────────
-- Attach with:  create trigger <t>_audit after insert or update or delete on <table>
--                 for each row execute function audit.capture('<pk column>');   -- default 'id'
-- actor_kind: no JWT → system · active admin → admin · otherwise business.
create function audit.capture() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_pk      text := coalesce(tg_argv[0], 'id');
  v_new     jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old     jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_uid     uuid := private.uid();
  v_changed jsonb;
  v_kind    public.actor_kind;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, jsonb_build_array(v_old -> k, v_new -> k)), '{}'::jsonb)
      into v_changed
    from jsonb_object_keys(v_new) as k
    where (v_old -> k) is distinct from (v_new -> k)
      and k not in ('updated_at');
    if v_changed = '{}'::jsonb then
      return null;                               -- no-op update: nothing to record
    end if;
  else
    v_changed := v_row;
  end if;

  v_kind := case
    when v_uid is null then 'system'
    when exists (select 1 from public.admin_users a where a.user_id = v_uid and a.is_active) then 'admin'
    else 'business'
  end;

  insert into audit.entity_changes (table_name, row_id, business_id, actor_user_id, actor_kind, op, changed)
  values (tg_table_schema || '.' || tg_table_name,
          (v_row ->> v_pk)::uuid,
          (v_row ->> 'business_id')::uuid,
          v_uid, v_kind, tg_op, v_changed);
  return null;
end $$;
-- audit.capture references public.admin_users, which the next migration creates.
-- plpgsql resolves it at call time, so creation order is fine.

select private.assign_app_ownership();
