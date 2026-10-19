-- Existing ERP profiles and auth.users are authoritative. No service-role client is required.
begin;

create table public.ha_clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  emr text not null default 'other' check (emr in ('dentweb','ysarang','other')),
  owner text not null default '' check (length(owner) <= 100),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);
create table public.ha_memberships (
  clinic_id uuid not null references public.ha_clinics(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('editor','viewer')),
  updated_at timestamptz not null default now(),
  primary key (clinic_id,user_id)
);
create table public.ha_snapshots (
  clinic_id uuid primary key references public.ha_clinics(id),
  revision bigint not null default 0 check (revision >= 0),
  object_path text,
  sha256 text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check ((revision=0 and object_path is null and sha256 is null) or
         (revision>0 and object_path is not null and sha256 ~ '^[0-9a-f]{64}$'))
);
create table public.ha_audit (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references public.ha_clinics(id),
  actor_id uuid references auth.users(id),
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create function public.ha_active() returns boolean language sql stable security definer
set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.resigned_at is null)
$$;
create function public.ha_admin() returns boolean language sql stable security definer
set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin' and p.resigned_at is null)
$$;
create function public.ha_can_access(target uuid, writing boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select public.ha_active() and exists(select 1 from public.ha_clinics where id=target) and
 (public.ha_admin() or exists(select 1 from public.ha_memberships m where m.clinic_id=target
  and m.user_id=(select auth.uid()) and (not writing or m.role='editor')))
$$;
create function public.ha_object_clinic(object_name text) returns uuid language sql immutable
set search_path='' as $$
 select case when object_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(uploads|snapshots)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(xlsx|zip)$'
 then split_part(object_name,'/',1)::uuid else null end
$$;

alter table public.ha_clinics enable row level security;
alter table public.ha_memberships enable row level security;
alter table public.ha_snapshots enable row level security;
alter table public.ha_audit enable row level security;
revoke all on public.ha_clinics,public.ha_memberships,public.ha_snapshots,public.ha_audit from anon,authenticated;
grant select,insert,update on public.ha_clinics to authenticated;
grant select,insert,update,delete on public.ha_memberships to authenticated;
grant select on public.ha_snapshots,public.ha_audit to authenticated;
create policy ha_clinic_read on public.ha_clinics for select to authenticated using (public.ha_can_access(id));
create policy ha_clinic_create on public.ha_clinics for insert to authenticated with check (public.ha_admin() and created_by=(select auth.uid()));
create policy ha_clinic_update on public.ha_clinics for update to authenticated using (public.ha_admin()) with check (public.ha_admin());
create policy ha_member_read on public.ha_memberships for select to authenticated using (public.ha_admin() or (user_id=(select auth.uid()) and public.ha_active()));
create policy ha_member_create on public.ha_memberships for insert to authenticated with check (public.ha_admin());
create policy ha_member_update on public.ha_memberships for update to authenticated using (public.ha_admin()) with check (public.ha_admin());
create policy ha_member_delete on public.ha_memberships for delete to authenticated using (public.ha_admin());
create policy ha_snapshot_read on public.ha_snapshots for select to authenticated using (public.ha_can_access(clinic_id));
create policy ha_audit_read on public.ha_audit for select to authenticated using (public.ha_admin());

create function public.ha_initialize_clinic() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.ha_snapshots(clinic_id) values(new.id);
 insert into public.ha_audit(clinic_id,actor_id,action) values(new.id,auth.uid(),'clinic.created');
 return new;
end $$;
create trigger ha_initialize after insert on public.ha_clinics for each row execute function public.ha_initialize_clinic();

create function public.ha_membership_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
   insert into public.ha_audit(clinic_id,actor_id,action,detail)
   values(old.clinic_id,auth.uid(),'membership.revoked',jsonb_build_object('user_id',old.user_id,'role',old.role));
   return old;
 end if;
 new.updated_at=now();
 insert into public.ha_audit(clinic_id,actor_id,action,detail)
 values(new.clinic_id,auth.uid(),'membership.assigned',jsonb_build_object('user_id',new.user_id,'role',new.role));
 return new;
end $$;
create trigger ha_membership_changed before insert or update or delete on public.ha_memberships
for each row execute function public.ha_membership_audit();

create function public.ha_commit_snapshot(target uuid, expected_revision bigint, new_path text, new_sha256 text)
returns bigint language plpgsql security definer set search_path='' as $$
declare committed bigint;
begin
 if not public.ha_can_access(target,true) then raise exception 'analytics access denied' using errcode='42501'; end if;
 if public.ha_object_clinic(new_path) is distinct from target or
    split_part(new_path,'/',2)<>'snapshots' or right(new_path,4)<>'.zip' or
    new_sha256 is null or new_sha256 !~ '^[0-9a-f]{64}$' then
   raise exception 'invalid snapshot reference' using errcode='22023';
 end if;
 if not exists(select 1 from storage.objects where bucket_id='hospital-analytics' and name=new_path) then
   raise exception 'snapshot object missing' using errcode='22023';
 end if;
 update public.ha_snapshots set revision=revision+1,object_path=new_path,sha256=new_sha256,updated_at=now(),updated_by=auth.uid()
 where clinic_id=target and revision=expected_revision returning revision into committed;
 if committed is null then raise exception 'snapshot revision conflict' using errcode='40001'; end if;
 insert into public.ha_audit(clinic_id,actor_id,action,detail)
 values(target,auth.uid(),'snapshot.committed',jsonb_build_object('revision',committed));
 return committed;
end $$;

-- Private immutable objects. Restrictive policies prevent older broad permissive
-- Storage policies in this ERP from accidentally opening this new bucket.
insert into storage.buckets(id,name,public,file_size_limit)
values('hospital-analytics','hospital-analytics',false,52428800);
create policy ha_storage_read on storage.objects for select to authenticated
using (bucket_id='hospital-analytics' and public.ha_can_access(public.ha_object_clinic(name)));
create policy ha_storage_insert on storage.objects for insert to authenticated
with check (bucket_id='hospital-analytics' and public.ha_can_access(public.ha_object_clinic(name),true));
create policy ha_storage_read_fence on storage.objects as restrictive for select to public
using (bucket_id<>'hospital-analytics' or (public.ha_can_access(public.ha_object_clinic(name)) and
 storage.allow_any_operation(array['object.get_authenticated','object.list','object.list_v2','object.get_authenticated_info','object.head_authenticated_info','object.upload'])));
create policy ha_storage_insert_fence on storage.objects as restrictive for insert to public
with check (bucket_id<>'hospital-analytics' or (public.ha_can_access(public.ha_object_clinic(name),true) and storage.allow_only_operation('object.upload')));
create policy ha_storage_update_fence on storage.objects as restrictive for update to public
using (bucket_id<>'hospital-analytics') with check (bucket_id<>'hospital-analytics');
create policy ha_storage_delete_fence on storage.objects as restrictive for delete to public
using (bucket_id<>'hospital-analytics');

revoke all on function public.ha_active(),public.ha_admin(),public.ha_can_access(uuid,boolean),
 public.ha_object_clinic(text),public.ha_initialize_clinic(),public.ha_membership_audit(),
 public.ha_commit_snapshot(uuid,bigint,text,text) from public;
grant execute on function public.ha_active(),public.ha_admin(),public.ha_can_access(uuid,boolean),public.ha_object_clinic(text) to anon,authenticated;
grant execute on function public.ha_commit_snapshot(uuid,bigint,text,text) to authenticated;
commit;
