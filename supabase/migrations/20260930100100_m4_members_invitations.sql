-- M4 · Business members & invitations
-- Spec: Phase 3 Part 2 §5.2 (invite_member, accept_invitation, change_member_role, revoke_member,
--       transfer_ownership; managers can't modify owners or managers), Part 1 §6.3, Phase 2 B1/B7.
-- Invitations are bound to a phone number: accepting needs an OTP-verified session on that number.
-- The raw token exists only in the invite link (WhatsApp in M7; shown to the inviter until then).

alter table private.business_invitations add column revoked_at timestamptz;
alter table private.business_invitations
  add constraint business_invitations_one_outcome check (accepted_at is null or revoked_at is null);
alter table private.business_invitations
  add constraint business_invitations_role check (role <> 'owner' or staff_id is null);
create index on private.business_invitations (phone_e164) where accepted_at is null and revoked_at is null;

create trigger business_invitations_audit after insert or update or delete on private.business_invitations
  for each row execute function audit.capture();

-- The caller's active role in a business (null if none)
create function private.my_role(p_business_id uuid) returns public.business_role
language sql stable security definer set search_path = '' as $$
  select m.role from public.business_members m
  where m.business_id = p_business_id and m.user_id = private.uid() and m.status = 'active'
$$;

-- Who may assign / change / remove which role (Part 1 §6.3 "Members & roles").
-- Owner: manager, reception, staff. Manager: reception, staff. Ops admins (aal2): any, including
-- the first owner of a business ops onboarded. Nobody changes the owner except transfer_ownership.
create function private.assert_can_manage_role(p_business_id uuid, p_role public.business_role) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_mine public.business_role := private.my_role(p_business_id);
begin
  if private.is_admin('{ops}') then return; end if;
  if v_mine = 'owner' and p_role in ('manager', 'reception', 'staff') then return; end if;
  if v_mine = 'manager' and p_role in ('reception', 'staff') then return; end if;
  perform private.raise_code('FORBIDDEN');
end $$;

-- ─── invite_member ─────────────────────────────────────────────────────────
create function public.invite_member(p_business_id uuid, p_phone text, p_role public.business_role,
                                     p_staff_id uuid default null)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := private.uid();
  v_phone text := private.normalize_phone(private.normalize_digits(p_phone));
  v_token text := private.new_token();
  v_id uuid; v_exp timestamptz := now() + interval '7 days';
begin
  if v_uid is null or private.is_anonymous() then perform private.raise_code('AUTH_REQUIRED'); end if;
  perform private.assert_can_manage_role(p_business_id, p_role);
  if v_phone is null then perform private.raise_code('INVALID_PHONE'); end if;
  if p_role = 'owner' then
    if p_staff_id is not null then perform private.raise_code('NOT_SUPPORTED'); end if;
    if exists (select 1 from public.business_members where business_id = p_business_id and role = 'owner' and status = 'active') then
      perform private.raise_code('OWNER_EXISTS');
    end if;
  end if;
  if p_staff_id is not null and not exists (
       select 1 from public.staff_members s
       where s.id = p_staff_id and s.business_id = p_business_id and s.status = 'active' and s.user_id is null) then
    perform private.raise_code('STAFF_NOT_LINKABLE');
  end if;
  if exists (select 1 from public.business_members m join public.profiles p on p.id = m.user_id
             where m.business_id = p_business_id and m.status = 'active'
               and p.phone_e164 = v_phone and p.phone_verified_at is not null) then
    perform private.raise_code('MEMBER_EXISTS');
  end if;
  perform private.hit_rate_limit('invite', p_business_id::text, 30, interval '1 day');

  -- A new invite for the same number replaces any pending one
  update private.business_invitations set revoked_at = now()
   where business_id = p_business_id and phone_e164 = v_phone and accepted_at is null and revoked_at is null;

  insert into private.business_invitations (business_id, phone_e164, role, staff_id, token_hash, expires_at, created_by)
  values (p_business_id, v_phone, p_role, p_staff_id, encode(private.token_hash(v_token), 'hex'), v_exp, v_uid)
  returning id into v_id;

  return jsonb_build_object('invitation_id', v_id, 'token', v_token, 'expires_at', v_exp,
                            'phone_e164', v_phone, 'role', p_role);
end $$;

-- ─── Invitation preview (invite landing page, logged out) ──────────────────
create function public.get_invitation(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i private.business_invitations; v_name text;
begin
  select * into i from private.business_invitations where token_hash = encode(private.token_hash(p_token), 'hex');
  if i.id is null then perform private.raise_code('INVITE_INVALID'); end if;
  select name into v_name from public.businesses where id = i.business_id;
  return jsonb_build_object(
    'business_name', v_name, 'role', i.role, 'phone_hint', private.mask_phone(i.phone_e164),
    'expires_at', i.expires_at,
    'state', case when i.accepted_at is not null then 'accepted'
                  when i.revoked_at is not null then 'revoked'
                  when i.expires_at <= now() then 'expired'
                  else 'valid' end);
end $$;

-- ─── accept_invitation ─────────────────────────────────────────────────────
create function public.accept_invitation(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_phone text := private.require_verified_customer();
  v_uid uuid := private.uid();
  i private.business_invitations;
begin
  perform private.hit_rate_limit('invite_accept', v_uid::text, 20, interval '1 hour');
  select * into i from private.business_invitations
   where token_hash = encode(private.token_hash(p_token), 'hex') for update;
  if i.id is null or i.revoked_at is not null then perform private.raise_code('INVITE_INVALID'); end if;
  if i.accepted_at is not null then
    if i.accepted_by = v_uid then
      return jsonb_build_object('business_id', i.business_id, 'role', i.role, 'already_accepted', true);
    end if;
    perform private.raise_code('INVITE_INVALID');
  end if;
  if i.expires_at <= now() then perform private.raise_code('INVITE_EXPIRED'); end if;
  if v_phone is distinct from i.phone_e164 then perform private.raise_code('INVITE_PHONE_MISMATCH'); end if;
  if i.role = 'owner' and exists (select 1 from public.business_members
                                  where business_id = i.business_id and role = 'owner' and status = 'active'
                                    and user_id <> v_uid) then
    perform private.raise_code('OWNER_EXISTS');
  end if;
  if exists (select 1 from public.business_members
             where business_id = i.business_id and user_id = v_uid and status = 'active' and role = 'owner'
               and i.role <> 'owner') then
    perform private.raise_code('FORBIDDEN');     -- an owner never demotes themself through an invite
  end if;

  insert into public.business_members as m (business_id, user_id, role, status, invited_by)
  values (i.business_id, v_uid, i.role, 'active', i.created_by)
  on conflict (business_id, user_id) do update set role = excluded.role, status = 'active', invited_by = excluded.invited_by;

  if i.staff_id is not null then
    if exists (select 1 from public.staff_members where business_id = i.business_id and user_id = v_uid and id <> i.staff_id) then
      perform private.raise_code('STAFF_ALREADY_LINKED');
    end if;
    update public.staff_members set user_id = v_uid
     where id = i.staff_id and business_id = i.business_id and (user_id is null or user_id = v_uid);
    if not found then perform private.raise_code('STAFF_NOT_LINKABLE'); end if;
  end if;

  update private.business_invitations set accepted_at = now(), accepted_by = v_uid where id = i.id;
  return jsonb_build_object('business_id', i.business_id, 'role', i.role, 'already_accepted', false);
end $$;

-- ─── Pending invitations (team screen) and revoke ──────────────────────────
create function public.list_invitations(p_business_id uuid)
returns table (invitation_id uuid, phone_e164 text, role public.business_role, staff_id uuid,
               expires_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.has_business_role(p_business_id, '{owner,manager}') or private.is_admin('{ops}')) then
    perform private.raise_code('FORBIDDEN');
  end if;
  return query
  select i.id, i.phone_e164, i.role, i.staff_id, i.expires_at, i.created_at
  from private.business_invitations i
  where i.business_id = p_business_id and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  order by i.created_at desc;
end $$;

create function public.revoke_invitation(p_invitation_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare i private.business_invitations;
begin
  select * into i from private.business_invitations where id = p_invitation_id for update;
  if i.id is null then perform private.raise_code('FORBIDDEN'); end if;
  perform private.assert_can_manage_role(i.business_id, i.role);
  if i.accepted_at is not null then perform private.raise_code('INVITE_INVALID'); end if;
  update private.business_invitations set revoked_at = coalesce(revoked_at, now()) where id = i.id;
end $$;

-- ─── Role changes ──────────────────────────────────────────────────────────
create function public.change_member_role(p_business_id uuid, p_user_id uuid, p_role public.business_role)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.business_members;
begin
  if p_user_id = private.uid() then perform private.raise_code('FORBIDDEN'); end if;
  select * into m from public.business_members
   where business_id = p_business_id and user_id = p_user_id and status = 'active' for update;
  if m.user_id is null then perform private.raise_code('FORBIDDEN'); end if;
  if m.role = 'owner' or p_role = 'owner' then perform private.raise_code('FORBIDDEN'); end if;  -- transfer_ownership
  perform private.assert_can_manage_role(p_business_id, m.role);   -- may touch the current role
  perform private.assert_can_manage_role(p_business_id, p_role);   -- and may grant the new one
  update public.business_members set role = p_role where business_id = p_business_id and user_id = p_user_id;
end $$;

create function public.revoke_member(p_business_id uuid, p_user_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare m public.business_members;
begin
  if p_user_id = private.uid() then perform private.raise_code('FORBIDDEN'); end if;
  select * into m from public.business_members
   where business_id = p_business_id and user_id = p_user_id and status = 'active' for update;
  if m.user_id is null or m.role = 'owner' then perform private.raise_code('FORBIDDEN'); end if;
  perform private.assert_can_manage_role(p_business_id, m.role);
  update public.business_members set status = 'revoked' where business_id = p_business_id and user_id = p_user_id;
  -- The staff profile stays (history, reviews); only the login link is removed
  update public.staff_members set user_id = null where business_id = p_business_id and user_id = p_user_id;
end $$;

-- ─── transfer_ownership (danger zone: owner only, or ops) ──────────────────
create function public.transfer_ownership(p_business_id uuid, p_new_owner_user_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not (private.my_role(p_business_id) = 'owner' or private.is_admin('{ops}')) then
    perform private.raise_code('FORBIDDEN');
  end if;
  if not exists (select 1 from public.business_members
                 where business_id = p_business_id and user_id = p_new_owner_user_id and status = 'active'
                   and role <> 'owner') then
    perform private.raise_code('FORBIDDEN');
  end if;
  -- demote first: exactly one active owner at any time (unique index)
  update public.business_members set role = 'manager'
   where business_id = p_business_id and role = 'owner' and status = 'active';
  update public.business_members set role = 'owner'
   where business_id = p_business_id and user_id = p_new_owner_user_id;
end $$;

grant execute on function public.invite_member(uuid, text, public.business_role, uuid) to authenticated;
grant execute on function public.get_invitation(text)                                 to anon, authenticated;
grant execute on function public.accept_invitation(text)                              to authenticated;
grant execute on function public.list_invitations(uuid)                               to authenticated;
grant execute on function public.revoke_invitation(uuid)                              to authenticated;
grant execute on function public.change_member_role(uuid, uuid, public.business_role) to authenticated;
grant execute on function public.revoke_member(uuid, uuid)                            to authenticated;
grant execute on function public.transfer_ownership(uuid, uuid)                       to authenticated;

select private.assign_app_ownership();
