-- Read only. Run against the ERP's actual Supabase project before migration.
select current_database() as database_name, now() as checked_at;
select table_schema,table_name,column_name,data_type from information_schema.columns
where table_schema='public' and table_name='profiles' and column_name in ('id','role','resigned_at');
select to_regprocedure('storage.allow_only_operation(text)') as storage_operation_helper,
       to_regprocedure('storage.allow_any_operation(text[])') as storage_operations_helper;
select id,name,public,file_size_limit from storage.buckets where id='hospital-analytics';
select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where (schemaname='public' and tablename='profiles') or (schemaname='storage' and tablename='objects');
select table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='profiles' and grantee in ('anon','authenticated');
