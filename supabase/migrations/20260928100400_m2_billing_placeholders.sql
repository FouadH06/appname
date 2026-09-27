-- M2 · Subscription placeholders (no payments at launch)
-- Spec: Phase 3 Part 5 §9, locked decisions (businesses free during launch)
-- payments / marketplace_fees / sponsored_placements reference bookings and arrive with M3+.

create table public.plans (
  id             uuid primary key default gen_random_uuid(),
  key            extensions.citext not null unique,
  name           text not null,
  price_monthly  numeric(10,2) check (price_monthly >= 0),
  currency       char(3) not null default 'USD',
  is_public      boolean not null default false,
  is_active      boolean not null default true,
  sort           int not null default 0
);

create table public.plan_entitlements (
  plan_id  uuid not null references public.plans(id) on delete cascade,
  key      text not null check (key ~ '^[a-z][a-z_]{1,40}$'),
  value    jsonb not null,
  primary key (plan_id, key)
);

create table public.business_subscriptions (
  business_id                uuid primary key references public.businesses(id),
  plan_id                    uuid not null references public.plans(id),
  status                     public.subscription_status not null default 'free_launch',
  current_period_start       timestamptz,
  current_period_end         timestamptz,
  provider                   text,
  provider_customer_ref      text,
  provider_subscription_ref  text,
  cancel_at                  timestamptz,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create trigger business_subscriptions_updated_at before update on public.business_subscriptions
  for each row execute function private.set_updated_at();

-- Launch plan: everything in the MVP is included. Later plans are added as data, not code.
insert into public.plans (key, name, price_monthly, is_public, sort)
values ('launch_free', 'Free during launch', 0, false, 0);

insert into public.plan_entitlements (plan_id, key, value)
select p.id, e.key, e.value::jsonb
from public.plans p
cross join (values
  ('crm', 'true'), ('basic_analytics', 'true'), ('advanced_analytics', 'true'), ('reviews_tools', 'true'),
  ('staff_max', '100'), ('multi_location', 'false'), ('promotions', 'false'), ('ai_features', 'false')
) as e(key, value)
where p.key = 'launch_free';

-- Every business gets a subscription row on the launch plan
create function private.bootstrap_business_subscription() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_subscriptions (business_id, plan_id, status)
  select new.id, p.id, 'free_launch' from public.plans p where p.key = 'launch_free';
  return null;
end $$;
create trigger businesses_subscription_bootstrap after insert on public.businesses
  for each row execute function private.bootstrap_business_subscription();

-- true when the business's plan grants the entitlement (boolean true, or a positive number)
create function private.has_entitlement(p_business_id uuid, p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case jsonb_typeof(e.value)
             when 'boolean' then (e.value)::text::boolean
             when 'number'  then (e.value)::text::numeric > 0
             else false
           end
    from public.business_subscriptions s
    join public.plan_entitlements e on e.plan_id = s.plan_id and e.key = p_key
    where s.business_id = p_business_id
      and s.status in ('free_launch', 'trialing', 'active', 'past_due')
  ), false)
$$;
grant execute on function private.has_entitlement(uuid, text) to authenticated;

-- ─── RLS (Part 6 §3.3) ─────────────────────────────────────────────────────
alter table public.plans                  enable row level security;
alter table public.plan_entitlements      enable row level security;
alter table public.business_subscriptions enable row level security;

-- Plan definitions aren't sensitive: any signed-in user may read active plans.
grant select on public.plans, public.plan_entitlements to authenticated;
create policy plans_read on public.plans for select to authenticated
  using (is_active or (select private.is_admin('{superadmin}')));
create policy plan_entitlements_read on public.plan_entitlements for select to authenticated
  using (true);

grant select on public.business_subscriptions to authenticated;
create policy subscriptions_manage_read on public.business_subscriptions for select to authenticated
  using (business_id in (select private.my_business_ids('{owner,manager}')) or (select private.is_admin()));

create trigger business_subscriptions_audit after insert or update or delete on public.business_subscriptions
  for each row execute function audit.capture('business_id');

select private.assign_app_ownership();
