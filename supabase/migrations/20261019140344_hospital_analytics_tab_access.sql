-- Tab access is independent of clinic registration and applies to every clinic.
-- Keep historical clinic memberships/audit for evidence; they no longer grant access.
begin;
create table public.ha_tab_memberships (
  user_id uuid primary key references auth.users(id),
  updated_at timestamptz not null default now()
);
create table public.ha_tab_access_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  actor_id uuid references auth.users(id),
  action text not null check (action in ('granted','revoked')),
  created_at timestamptz not null default now()
);
alter table public.ha_tab_memberships enable row level security;
alter table public.ha_tab_access_audit enable row level security;
revoke all on public.ha_tab_memberships,public.ha_tab_access_audit from public,anon,authenticated;
revoke all on sequence public.ha_tab_access_audit_id_seq from public,anon,authenticated;
grant select,insert,update,delete on public.ha_tab_memberships to authenticated;
grant select on public.ha_tab_access_audit to authenticated;
create policy ha_tab_member_read on public.ha_tab_memberships for select to authenticated
using (public.ha_admin() or (user_id=(select auth.uid()) and public.ha_active()));
create policy ha_tab_member_create on public.ha_tab_memberships for insert to authenticated with check (public.ha_admin());
create policy ha_tab_member_update on public.ha_tab_memberships for update to authenticated using (public.ha_admin()) with check (public.ha_admin());
create policy ha_tab_member_delete on public.ha_tab_memberships for delete to authenticated using (public.ha_admin());
create policy ha_tab_audit_read on public.ha_tab_access_audit for select to authenticated using (public.ha_admin());

create function public.ha_tab_access() returns boolean language sql stable security definer set search_path='' as $$
  select public.ha_active() and (public.ha_admin() or exists(
    select 1 from public.ha_tab_memberships where user_id=(select auth.uid())
  ))
$$;
-- Retain the signature used by Storage fences and the snapshot commit RPC.
-- Every selected employee can use the tab's analysis/editing functions.
create or replace function public.ha_can_access(target uuid, writing boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
  select public.ha_tab_access() and exists(select 1 from public.ha_clinics where id=target)
$$;
create function public.ha_audit_tab_access() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    insert into public.ha_tab_access_audit(user_id,actor_id,action) values(old.user_id,auth.uid(),'revoked');
    return old;
  end if;
  new.updated_at=now();
  insert into public.ha_tab_access_audit(user_id,actor_id,action) values(new.user_id,auth.uid(),'granted');
  return new;
end $$;
create trigger ha_tab_membership_changed before insert or update or delete on public.ha_tab_memberships
for each row execute function public.ha_audit_tab_access();
revoke all on function public.ha_tab_access(),public.ha_audit_tab_access() from public,anon,authenticated;
grant execute on function public.ha_tab_access() to anon,authenticated;
commit;
