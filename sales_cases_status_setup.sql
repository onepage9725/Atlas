alter table public.sales_cases
  add column if not exists booking_date date default current_date,
  add column if not exists customer_contact_number text,
  add column if not exists customer_address text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_relationship text,
  add column if not exists emergency_contact_ic_passport text,
  add column if not exists emergency_contact_number text,
  add column if not exists emergency_contact_email text,
  add column if not exists involved_profile_id uuid,
  add column if not exists status text not null default 'Pending',
  add column if not exists lo_draft_url text,
  add column if not exists signed_lo_date date,
  add column if not exists commission_structure jsonb,
  add column if not exists commission_review_sent_at timestamptz,
  add column if not exists commission_review_sent_by uuid;

alter table public.projects
  add column if not exists direct_commission numeric,
  add column if not exists holding_commission numeric;

update public.projects
set
  direct_commission = coalesce(direct_commission, company_commission + agent_commission + pre_leader_override + leader_override),
  holding_commission = coalesce(holding_commission, 0)
where direct_commission is null
   or holding_commission is null;

create table if not exists public.sales_case_payouts (
  id uuid primary key default gen_random_uuid(),
  sales_case_id uuid not null references public.sales_cases(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  payout_type text not null default 'standard',
  source_commission_structure_id text,
  source_commission_structure_label text,
  target_commission_structure_id text,
  target_commission_structure_label text,
  agent_commission_percentage numeric not null default 0,
  pre_leader_override_percentage numeric not null default 0,
  leader_override_percentage numeric not null default 0,
  total_amount numeric not null default 0,
  payout_status text not null default 'Pending',
  payment_receipt_url text,
  approved_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  rejected_at timestamptz,
  rejected_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.sales_case_payouts
  add column if not exists payout_type text not null default 'standard',
  add column if not exists source_commission_structure_id text,
  add column if not exists source_commission_structure_label text,
  add column if not exists target_commission_structure_id text,
  add column if not exists target_commission_structure_label text;

alter table public.sales_case_payouts
  drop constraint if exists sales_case_payouts_sales_case_id_profile_id_key;

alter table public.sales_case_payouts
  drop constraint if exists sales_case_payouts_status_check;

alter table public.sales_case_payouts
  add constraint sales_case_payouts_status_check
  check (payout_status in ('Pending', 'Approve', 'Reject', 'Paid'));

alter table public.sales_case_payouts
  drop constraint if exists sales_case_payouts_type_check;

alter table public.sales_case_payouts
  add constraint sales_case_payouts_type_check
  check (payout_type in ('standard', 'tier_upgrade_top_up'));

create unique index if not exists sales_case_payouts_standard_unique_idx
  on public.sales_case_payouts (sales_case_id, profile_id)
  where payout_type = 'standard';

create unique index if not exists sales_case_payouts_tier_upgrade_top_up_unique_idx
  on public.sales_case_payouts (
    sales_case_id,
    profile_id,
    source_commission_structure_id,
    target_commission_structure_id
  )
  where payout_type = 'tier_upgrade_top_up';

update public.sales_cases
set involved_profile_id = (
  select profile_id
  from unnest(coalesce(involved_user_ids, '{}'::uuid[])) as profile_id
  where profile_id <> created_by
  group by profile_id
  having count(*) = 1
  limit 1
)
where involved_profile_id is null
  and (
    select count(*)
    from unnest(coalesce(involved_user_ids, '{}'::uuid[])) as profile_id
    where profile_id <> created_by
  ) = 1;

alter table public.sales_cases
  alter column booking_date set default current_date;

update public.sales_cases
set booking_date = created_at::date
where booking_date is null;

update public.sales_cases
set status = 'Pending'
where status is null;

alter table public.sales_cases
  drop constraint if exists sales_cases_status_check;

alter table public.sales_cases
  add constraint sales_cases_status_check
  check (status in ('Pending', 'Signed LO', 'Cancel', 'Claimable', 'Approve', 'Paid', 'Reject'));

drop policy if exists sales_cases_insert_creator on public.sales_cases;
create policy sales_cases_insert_creator
on public.sales_cases
for insert
to authenticated
with check (
  auth.uid() = created_by
  and status in ('Pending', 'Signed LO', 'Cancel')
);

drop policy if exists sales_cases_insert_admin on public.sales_cases;
create policy sales_cases_insert_admin
on public.sales_cases
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
  and exists (
    select 1
    from public.profiles as case_owner
    where case_owner.id = created_by
      and case_owner.role not in ('admin', 'super_admin')
  )
  and status = 'Pending'
);

drop policy if exists sales_cases_update_creator_status on public.sales_cases;
create policy sales_cases_update_creator_status
on public.sales_cases
for update
to authenticated
using (auth.uid() = created_by)
with check (
  auth.uid() = created_by
  and status in ('Pending', 'Signed LO', 'Cancel')
);

drop policy if exists sales_cases_update_admin_status on public.sales_cases;
create policy sales_cases_update_admin_status
on public.sales_cases
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
  and status in ('Signed LO', 'Claimable', 'Approve', 'Paid', 'Reject')
);

drop policy if exists sales_cases_delete_super_admin on public.sales_cases;
create policy sales_cases_delete_super_admin
on public.sales_cases
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
  )
);

alter table public.sales_case_payouts enable row level security;

drop policy if exists sales_case_payouts_select_super_admin on public.sales_case_payouts;
drop policy if exists sales_case_payouts_select_related on public.sales_case_payouts;
create policy sales_case_payouts_select_related
on public.sales_case_payouts
for select
to authenticated
using (
  profile_id = auth.uid()
  or exists (
    select 1
    from public.sales_cases
    where sales_cases.id = sales_case_payouts.sales_case_id
      and (
        sales_cases.created_by = auth.uid()
        or auth.uid() = any(coalesce(sales_cases.involved_user_ids, '{}'::uuid[]))
      )
  )
  or exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
);

drop policy if exists sales_case_payouts_insert_super_admin on public.sales_case_payouts;
create policy sales_case_payouts_insert_super_admin
on public.sales_case_payouts
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
);

drop policy if exists sales_case_payouts_update_super_admin on public.sales_case_payouts;
create policy sales_case_payouts_update_super_admin
on public.sales_case_payouts
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
  )
);

drop policy if exists sales_case_payouts_delete_super_admin on public.sales_case_payouts;
create policy sales_case_payouts_delete_super_admin
on public.sales_case_payouts
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'super_admin'
  )
);

create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null,
  amount numeric not null default 0,
  description text,
  reference_label text,
  reference_detail text,
  attachment_url text,
  sales_case_id uuid references public.sales_cases(id) on delete set null,
  entry_scope text not null default 'manual',
  transacted_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.finance_entries
  add column if not exists attachment_url text;

alter table public.finance_entries
  add column if not exists payout_type text;

alter table public.finance_entries
  add column if not exists source_commission_structure_id text;

alter table public.finance_entries
  add column if not exists target_commission_structure_id text;

alter table public.finance_entries
  add column if not exists reference_detail text;

alter table public.finance_entries
  add column if not exists sales_case_id uuid references public.sales_cases(id) on delete set null;

alter table public.finance_entries
  add column if not exists entry_scope text not null default 'manual';

alter table public.finance_entries
  drop constraint if exists finance_entries_entry_type_check;

alter table public.finance_entries
  add constraint finance_entries_entry_type_check
  check (entry_type in ('cash_in', 'cash_out'));

alter table public.finance_entries
  drop constraint if exists finance_entries_entry_scope_check;

alter table public.finance_entries
  add constraint finance_entries_entry_scope_check
  check (entry_scope in ('manual', 'company_commission', 'company_commission_hidden'));

alter table public.profiles
  add column if not exists is_active boolean not null default true,
  add column if not exists personal_points numeric not null default 0,
  add column if not exists group_points numeric not null default 0;

update public.profiles
set is_active = true
where is_active is null;

update public.profiles
set personal_points = 0
where personal_points is null;

update public.profiles
set group_points = 0
where group_points is null;

alter table public.finance_entries enable row level security;

drop policy if exists finance_entries_select_admin on public.finance_entries;
create policy finance_entries_select_admin
on public.finance_entries
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
);

drop policy if exists finance_entries_insert_admin on public.finance_entries;
create policy finance_entries_insert_admin
on public.finance_entries
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
  and created_by = auth.uid()
);

drop policy if exists finance_entries_update_admin on public.finance_entries;
create policy finance_entries_update_admin
on public.finance_entries
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
);

drop policy if exists finance_entries_delete_admin on public.finance_entries;
create policy finance_entries_delete_admin
on public.finance_entries
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
);

alter table public.projects
  add column if not exists description text,
  add column if not exists is_hidden boolean not null default false,
  add column if not exists commission_structures jsonb not null default '[]'::jsonb,
  add column if not exists default_commission_structure_id text,
  add column if not exists bedroom_min integer,
  add column if not exists bedroom_max integer,
  add column if not exists bathroom_min integer,
  add column if not exists bathroom_max integer,
  add column if not exists cover_image_url text,
  add column if not exists attachment_1_url text,
  add column if not exists attachment_1_label text,
  add column if not exists attachment_2_url text,
  add column if not exists attachment_2_label text;

update public.projects
set commission_structures = jsonb_build_array(
  jsonb_build_object(
    'id', 'default-tier',
    'label', 'Default Tier',
    'min_units', null,
    'max_units', null,
    'company_commission', company_commission,
    'agent_commission', agent_commission,
    'pre_leader_override', pre_leader_override,
    'leader_override', leader_override
  )
)
where coalesce(jsonb_array_length(commission_structures), 0) = 0;

update public.projects
set default_commission_structure_id = coalesce(default_commission_structure_id, commission_structures->0->>'id')
where coalesce(default_commission_structure_id, '') = ''
  and coalesce(jsonb_array_length(commission_structures), 0) > 0;

update public.sales_cases
set commission_structure = jsonb_build_object(
  'id', 'default-tier',
  'label', 'Default Tier',
  'min_units', null,
  'max_units', null,
  'company_commission', projects.company_commission,
  'agent_commission', projects.agent_commission,
  'pre_leader_override', projects.pre_leader_override,
  'leader_override', projects.leader_override
)
from public.projects
where sales_cases.project_id = projects.id
  and sales_cases.commission_structure is null;

create table if not exists public.website_settings (
  id integer primary key default 1,
  company_name text not null default 'ATLAS Property',
  company_description text,
  company_logo_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint website_settings_singleton_check check (id = 1)
);

insert into public.website_settings (id, company_name, company_description)
values (1, 'ATLAS Property', 'Malaysia Agency')
on conflict (id) do nothing;

alter table public.website_settings enable row level security;

drop policy if exists website_settings_select_authenticated on public.website_settings;
create policy website_settings_select_authenticated
on public.website_settings
for select
to authenticated
using (true);

drop policy if exists website_settings_insert_admin on public.website_settings;
create policy website_settings_insert_admin
on public.website_settings
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
);

drop policy if exists website_settings_update_admin on public.website_settings;
create policy website_settings_update_admin
on public.website_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role in ('admin', 'super_admin')
  )
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  sales_case_id uuid references public.sales_cases(id) on delete cascade,
  title text not null,
  message text not null,
  target_view text not null,
  is_read boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_target_view_check check (target_view in ('Dashboard', 'Manage Cases', 'Sales Cases'))
);

alter table public.notifications
  drop constraint if exists notifications_target_view_check;

alter table public.notifications
  add constraint notifications_target_view_check
  check (target_view in ('Dashboard', 'Manage Cases', 'Sales Cases'));

create index if not exists notifications_created_at_idx
  on public.notifications (created_at);

create extension if not exists pg_cron;

create or replace function public.cleanup_expired_notifications()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.notifications
  where created_at < now() - interval '7 days';
$$;

do $cleanup_notifications_schedule$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'cleanup-expired-notifications'
  ) then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'cleanup-expired-notifications';
  end if;

  perform cron.schedule(
    'cleanup-expired-notifications',
    '0 3 * * *',
    'select public.cleanup_expired_notifications();'
  );
end;
$cleanup_notifications_schedule$;

alter table public.notifications enable row level security;

drop policy if exists notifications_select_recipient on public.notifications;
create policy notifications_select_recipient
on public.notifications
for select
to authenticated
using (recipient_id = auth.uid());

drop policy if exists notifications_insert_authenticated on public.notifications;
create policy notifications_insert_authenticated
on public.notifications
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists notifications_update_recipient on public.notifications;
create policy notifications_update_recipient
on public.notifications
for update
to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

drop function if exists public.get_ranking_profiles();

create or replace function public.get_ranking_profiles()
returns table (
  id uuid,
  name text,
  email text,
  role text,
  rank text,
  recruit_by uuid,
  is_active boolean,
  avatar_url text,
  avatar_position_x numeric,
  avatar_position_y numeric,
  avatar_zoom numeric
)
language sql
security definer
set search_path = public
as $$
  select
    profiles.id,
    profiles.name,
    profiles.email,
    profiles.role,
    profiles.rank,
    profiles.recruit_by,
    profiles.is_active,
    profiles.avatar_url,
    profiles.avatar_position_x,
    profiles.avatar_position_y,
    profiles.avatar_zoom
  from public.profiles
  where profiles.deleted_at is null
    and auth.uid() is not null;
$$;

drop function if exists public.get_ranking_sales_cases();

create or replace function public.get_ranking_sales_cases()
returns table (
  id uuid,
  project_id uuid,
  booking_date date,
  spa_price numeric,
  nett_price numeric,
  booking_fee numeric,
  unit_number text,
  customer_name text,
  customer_id text,
  customer_contact_number text,
  customer_email text,
  race text,
  buyer_type text,
  booking_form_url text,
  lo_draft_url text,
  signed_lo_date date,
  commission_structure jsonb,
  status text,
  created_by uuid,
  involved_profile_id uuid,
  involved_user_ids uuid[],
  delete_requested boolean,
  delete_requested_by uuid,
  delete_requested_at timestamptz,
  edited_at timestamptz,
  edited_by uuid,
  edit_reviewed_at timestamptz,
  edit_reviewed_by uuid,
  commission_review_sent_at timestamptz,
  commission_review_sent_by uuid,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    sales_cases.id,
    sales_cases.project_id,
    sales_cases.booking_date,
    sales_cases.spa_price,
    sales_cases.nett_price,
    sales_cases.booking_fee,
    sales_cases.unit_number,
    sales_cases.customer_name,
    sales_cases.customer_id,
    sales_cases.customer_contact_number,
    sales_cases.customer_email,
    sales_cases.race,
    sales_cases.buyer_type,
    sales_cases.booking_form_url,
    sales_cases.lo_draft_url,
    sales_cases.signed_lo_date,
    sales_cases.commission_structure,
    sales_cases.status,
    sales_cases.created_by,
    sales_cases.involved_profile_id,
    sales_cases.involved_user_ids,
    sales_cases.delete_requested,
    sales_cases.delete_requested_by,
    sales_cases.delete_requested_at,
    sales_cases.edited_at,
    sales_cases.edited_by,
    sales_cases.edit_reviewed_at,
    sales_cases.edit_reviewed_by,
    sales_cases.commission_review_sent_at,
    sales_cases.commission_review_sent_by,
    sales_cases.created_at
  from public.sales_cases
  where auth.uid() is not null
  order by sales_cases.created_at desc;
$$;

revoke all on function public.get_ranking_profiles() from public;
revoke all on function public.get_ranking_sales_cases() from public;
grant execute on function public.get_ranking_profiles() to authenticated;
grant execute on function public.get_ranking_sales_cases() to authenticated;
