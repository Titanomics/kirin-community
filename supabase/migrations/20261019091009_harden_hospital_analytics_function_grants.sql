-- Supabase default ACLs grant EXECUTE directly to anon/authenticated, separately
-- from PUBLIC. Revoke every source before restoring the intended API surface.
begin;
revoke all on function public.ha_active(),public.ha_admin(),public.ha_can_access(uuid,boolean),
 public.ha_object_clinic(text),public.ha_initialize_clinic(),public.ha_membership_audit(),
 public.ha_commit_snapshot(uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.ha_active(),public.ha_admin(),public.ha_can_access(uuid,boolean),
 public.ha_object_clinic(text) to anon,authenticated;
grant execute on function public.ha_commit_snapshot(uuid,bigint,text,text) to authenticated;
commit;
