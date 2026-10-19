-- Database-owner smoke test. Synthetic HA rows only, always rolled back.
-- Existing profiles are only read to choose real authenticated identities.
begin;
do $$
declare admin_id uuid; editor_id uuid; viewer_id uuid;
begin
  select id into admin_id from public.profiles where role='admin' and resigned_at is null order by created_at limit 1;
  select id into editor_id from public.profiles where role<>'admin' and resigned_at is null order by created_at limit 1;
  select id into viewer_id from public.profiles where role<>'admin' and resigned_at is null and id<>editor_id order by created_at limit 1;
  if admin_id is null or editor_id is null or viewer_id is null then raise exception 'Need one active admin and two active employees'; end if;
  perform set_config('ha.test_admin',admin_id::text,true);
  perform set_config('ha.test_editor',editor_id::text,true);
  perform set_config('ha.test_viewer',viewer_id::text,true);
  perform set_config('ha.test_clinic',gen_random_uuid()::text,true);
  perform set_config('ha.test_other',gen_random_uuid()::text,true);
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('ha.test_admin'),true);
insert into public.ha_clinics(id,name,created_by) values
 (current_setting('ha.test_clinic')::uuid,'__rollback_test_A',auth.uid()),
 (current_setting('ha.test_other')::uuid,'__rollback_test_B',auth.uid());
insert into public.ha_memberships(clinic_id,user_id,role) values
 (current_setting('ha.test_clinic')::uuid,current_setting('ha.test_editor')::uuid,'editor'),
 (current_setting('ha.test_clinic')::uuid,current_setting('ha.test_viewer')::uuid,'viewer');
do $$ begin
  if (select count(*) from public.ha_snapshots where clinic_id in (current_setting('ha.test_clinic')::uuid,current_setting('ha.test_other')::uuid))<>2 then
    raise exception 'Snapshot initialization failed';
  end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('ha.test_editor'),true);
do $$ begin
  if not public.ha_can_access(current_setting('ha.test_clinic')::uuid,true) or public.ha_can_access(current_setting('ha.test_other')::uuid) then
    raise exception 'Editor clinic isolation failed';
  end if;
  if exists(select 1 from public.ha_audit) then raise exception 'Editor can read admin audit'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('ha.test_viewer'),true);
do $$ begin
  if not public.ha_can_access(current_setting('ha.test_clinic')::uuid) or public.ha_can_access(current_setting('ha.test_clinic')::uuid,true) then
    raise exception 'Viewer access failed';
  end if;
  begin
    insert into public.ha_memberships(clinic_id,user_id,role) values(current_setting('ha.test_other')::uuid,auth.uid(),'editor');
    raise exception 'Viewer assigned self';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('ha.test_admin'),true);
delete from public.ha_memberships where clinic_id=current_setting('ha.test_clinic')::uuid and user_id=current_setting('ha.test_editor')::uuid;
select set_config('request.jwt.claim.sub',current_setting('ha.test_editor'),true);
do $$ begin
  if public.ha_can_access(current_setting('ha.test_clinic')::uuid) then raise exception 'Revocation failed'; end if;
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin
    perform 1 from public.ha_clinics;
    raise exception 'Anonymous table access allowed';
  exception when insufficient_privilege then null;
  end;
  if has_function_privilege('anon','public.ha_commit_snapshot(uuid,bigint,text,text)','execute') then
    raise exception 'Anonymous commit privilege exists';
  end if;
end $$;
reset role;
select now() as measured_at, 'PASS: admin setup, editor isolation, viewer denial, revocation, anonymous denial; rolled back' as verification;
rollback;
