-- Prerequisite for trusting profiles.role / profiles.resigned_at in HA access.
-- Add a guard without replacing the ERP's existing policies or field checks.
begin;

create function public.ha_guard_profile_authorization() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.id is not distinct from old.id
     and new.role is not distinct from old.role
     and new.resigned_at is not distinct from old.resigned_at then
    return new;
  end if;

  -- Only trusted maintenance connections may act without an end-user JWT.
  -- A missing JWT on an authenticated/anon request is never a bypass.
  if auth.uid() is null and (
    current_setting('role', true) = 'service_role' or (
      session_user in ('postgres', 'supabase_admin') and
      coalesce(nullif(current_setting('role', true), 'none'), session_user)
        in ('postgres', 'supabase_admin')
    )
  ) then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'Profile identity cannot be changed' using errcode='42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.resigned_at is null
  ) then
    raise exception 'Only an active admin can change profile authorization' using errcode='42501';
  end if;
  return new;
end
$$;

revoke all on function public.ha_guard_profile_authorization() from public,anon,authenticated;
create trigger ha_guard_profile_authorization before update on public.profiles
for each row execute function public.ha_guard_profile_authorization();

commit;
