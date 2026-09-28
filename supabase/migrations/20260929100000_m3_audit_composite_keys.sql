-- M3 · Audit: record the full key for composite-key tables (M2 known limitation)
-- audit.capture('<pk>')                 → row_id from <pk> (unchanged)
-- audit.capture('<pk>', '<col2>', ...)  → row_id from <pk>; UPDATE diffs also carry
--                                         "_key": {"<pk>": ..., "<col2>": ...} so the row is identifiable.

create or replace function audit.capture() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_pk      text := coalesce(tg_argv[0], 'id');
  v_new     jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old     jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_uid     uuid := private.uid();
  v_changed jsonb;
  v_key     jsonb := '{}'::jsonb;
  v_kind    public.actor_kind;
  i         int;
begin
  if tg_nargs > 1 then
    for i in 0 .. tg_nargs - 1 loop
      v_key := v_key || jsonb_build_object(tg_argv[i], v_row -> tg_argv[i]);
    end loop;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, jsonb_build_array(v_old -> k, v_new -> k)), '{}'::jsonb)
      into v_changed
    from jsonb_object_keys(v_new) as k
    where (v_old -> k) is distinct from (v_new -> k)
      and k not in ('updated_at');
    if v_changed = '{}'::jsonb then
      return null;
    end if;
    if v_key <> '{}'::jsonb then
      v_changed := v_changed || jsonb_build_object('_key', v_key);
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

drop trigger staff_services_audit on public.staff_services;
create trigger staff_services_audit after insert or update or delete on public.staff_services
  for each row execute function audit.capture('staff_id', 'service_id');

select private.assign_app_ownership();
