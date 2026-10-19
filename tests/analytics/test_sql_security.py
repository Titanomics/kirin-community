"""Run the real migration against an isolated PostgreSQL with synthetic data only.

Usage: python tests/analytics/test_sql_security.py --postgres-bin PATH
No external DB, packages, credentials, or clinical data are used. A fresh cluster
is kept under ignored .local for inspection and is stopped even when tests fail.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase/migrations/20261019090646_hospital_analytics.sql"
PROFILE_GUARD = ROOT / "supabase/migrations/20261019090326_guard_hospital_analytics_profile_authorization.sql"
FUNCTION_GRANTS = ROOT / "supabase/migrations/20261019091009_harden_hospital_analytics_function_grants.sql"
ADMIN = "00000000-0000-4000-8000-000000000001"
EDITOR = "00000000-0000-4000-8000-000000000002"
VIEWER = "00000000-0000-4000-8000-000000000003"
UNASSIGNED = "00000000-0000-4000-8000-000000000004"
RESIGNED_ADMIN = "00000000-0000-4000-8000-000000000005"
RESIGNED_EDITOR = "00000000-0000-4000-8000-000000000006"
MISSING_PROFILE = "00000000-0000-4000-8000-000000000007"
CLINIC_A = "10000000-0000-4000-8000-000000000001"
CLINIC_B = "10000000-0000-4000-8000-000000000002"
OBJECT_A = f"{CLINIC_A}/snapshots/20000000-0000-4000-8000-000000000001.zip"
OBJECT_B = f"{CLINIC_B}/snapshots/20000000-0000-4000-8000-000000000001.zip"
NEW_OBJECT_A = f"{CLINIC_A}/uploads/20000000-0000-4000-8000-000000000002.xlsx"
NEW_OBJECT_B = f"{CLINIC_B}/uploads/20000000-0000-4000-8000-000000000002.xlsx"
CHECKSUM = "a" * 64
DB = None


def hidden_process_options():
    if os.name != "nt":
        return {}
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    return {"startupinfo": startup, "creationflags": subprocess.CREATE_NO_WINDOW}


class LocalPostgres:
    def __init__(self, binaries, port):
        self.binaries = Path(binaries).resolve()
        self.port = str(port)
        suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        self.work = ROOT / ".local" / f"analytics-sql-review-{suffix}"
        self.data = self.work / "cluster"
        self.started = False

    def command(self, executable, *args):
        ending = ".exe" if os.name == "nt" else ""
        return [str(self.binaries / (executable + ending)), *map(str, args)]

    def run(self, args, **kwargs):
        result = subprocess.run(args, text=True, encoding="utf-8", errors="replace",
                                capture_output=True, **hidden_process_options(), **kwargs)
        return result

    def start(self):
        self.work.mkdir(parents=True, exist_ok=False)
        init = self.run(self.command("initdb", "-D", self.data, "-U", "postgres",
                                     "--auth=trust", "--encoding=UTF8", "--locale=C"))
        if init.returncode:
            raise RuntimeError(init.stdout + init.stderr)
        # Windows server children can inherit pg_ctl's pipe handles, keeping
        # communicate() open after pg_ctl exits. Redirect startup to a real file.
        startup_log = self.work / "startup.log"
        with startup_log.open("w", encoding="utf-8") as stream:
            started = subprocess.run(self.command("pg_ctl", "-D", self.data, "-l", self.work / "server.log",
                                                   "-o", f"-h 127.0.0.1 -p {self.port}", "-w", "start"),
                                     stdout=stream, stderr=subprocess.STDOUT, timeout=70,
                                     **hidden_process_options())
        if started.returncode:
            raise RuntimeError(startup_log.read_text(encoding="utf-8"))
        self.started = True

    def stop(self):
        if self.started:
            result = self.run(self.command("pg_ctl", "-D", self.data, "-m", "fast", "-w", "stop"))
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)
            self.started = False

    def psql_command(self):
        return self.command("psql", "-X", "-h", "127.0.0.1", "-p", self.port,
                            "-U", "postgres", "-d", "postgres", "-qAt",
                            "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose")

    def sql(self, source):
        return self.run(self.psql_command(), input=source, timeout=30)

    def checked(self, source):
        result = self.sql(source)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)
        return result.stdout.strip()


def as_user(source, user=EDITOR, role="authenticated", rollback=True):
    identity = user or ""
    return (f"begin; set local role {role}; "
            f"set local request.jwt.claim.sub = '{identity}'; "
            f"set local storage.operation = 'object.upload';\n{source}\n"
            + ("rollback;" if rollback else "commit;"))


def commit_sql(clinic=CLINIC_A, expected=0, path=OBJECT_A, checksum=CHECKSUM):
    path_sql = "null" if path is None else "'" + path.replace("'", "''") + "'"
    sum_sql = "null" if checksum is None else "'" + checksum.replace("'", "''") + "'"
    return f"select public.ha_commit_snapshot('{clinic}',{expected},{path_sql},{sum_sql});"


class SecurityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if DB is None:
            raise unittest.SkipTest("Run this file directly with --postgres-bin to start an isolated SQL test cluster.")

    def successful(self, source, expected, user=EDITOR, role="authenticated"):
        self.assertEqual(DB.checked(as_user(source, user, role)), str(expected))

    def denied(self, source, user=EDITOR, role="authenticated", code="42501"):
        result = DB.sql(as_user(source, user, role))
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(code, result.stderr)

    def test_admin_reads_every_clinic_snapshot_and_membership(self):
        self.successful("select count(*) from public.ha_clinics; select count(*) from public.ha_snapshots; select count(*) from public.ha_memberships;", "2\n2\n4", ADMIN)

    def test_editor_and_viewer_read_only_assigned_clinic(self):
        for user in (EDITOR, VIEWER):
            with self.subTest(user=user):
                self.successful("select id from public.ha_clinics; select clinic_id from public.ha_snapshots; select count(*) from public.ha_memberships;", f"{CLINIC_A}\n{CLINIC_A}\n1", user)

    def test_unassigned_resigned_and_missing_profiles_read_no_analytics(self):
        for user in (UNASSIGNED, RESIGNED_ADMIN, RESIGNED_EDITOR, MISSING_PROFILE):
            with self.subTest(user=user):
                self.successful("select count(*) from public.ha_clinics; select count(*) from public.ha_snapshots; select count(*) from public.ha_memberships; select count(*) from public.ha_audit;", "0\n0\n0\n0", user)

    def test_anonymous_has_no_table_or_commit_privileges(self):
        for table in ("ha_clinics", "ha_memberships", "ha_snapshots", "ha_audit"):
            with self.subTest(table=table):
                self.denied(f"select * from public.{table};", None, "anon")
        self.denied(commit_sql(), None, "anon")

    def test_non_admin_cannot_create_clinic_or_assign_self(self):
        for user in (EDITOR, VIEWER, UNASSIGNED, RESIGNED_ADMIN):
            with self.subTest(user=user):
                self.denied(f"insert into public.ha_clinics(name,created_by) values('synthetic','{user}');", user)
                self.denied(f"insert into public.ha_memberships(clinic_id,user_id,role) values('{CLINIC_B}','{user}','editor');", user)

    def test_non_admin_cannot_edit_or_revoke_memberships(self):
        self.successful("with changed as (update public.ha_memberships set role='editor' returning *) select count(*) from changed; with removed as (delete from public.ha_memberships returning *) select count(*) from removed;", "0\n0", VIEWER)

    def test_admin_can_manage_clinics_and_memberships(self):
        self.successful(f"insert into public.ha_clinics(name,created_by) values('synthetic','{ADMIN}'); update public.ha_clinics set name='synthetic updated'; insert into public.ha_memberships values('{CLINIC_B}','{UNASSIGNED}','viewer',now()); select count(*) from public.ha_clinics; select count(*) from public.ha_snapshots; select count(*) from public.ha_memberships;", "3\n3\n5", ADMIN)

    def test_admin_cannot_forge_clinic_creator(self):
        self.denied(f"insert into public.ha_clinics(name,created_by) values('synthetic','{EDITOR}');", ADMIN)

    def test_new_clinic_requires_insert_without_returning_then_separate_read(self):
        # Characterize the live PostgREST boundary used by clinic creation:
        # the STABLE ha_can_access lookup cannot see INSERT's new row yet.
        clinic = '10000000-0000-4000-8000-000000000099'
        insert = f"insert into public.ha_clinics(id,name,created_by) values('{clinic}','synthetic','{ADMIN}')"
        self.denied(insert + ' returning id;', ADMIN)
        self.successful(insert + f"; select id from public.ha_clinics where id='{clinic}'; select revision from public.ha_snapshots where clinic_id='{clinic}';",
                        clinic + '\n0', ADMIN)

    def test_audit_only_visible_to_active_admin(self):
        self.successful("select count(*) from public.ha_audit;", 6, ADMIN)
        self.successful("select count(*) from public.ha_audit;", 0, EDITOR)

    def test_direct_snapshot_and_audit_writes_denied_even_admin(self):
        for user in (ADMIN, EDITOR, VIEWER):
            with self.subTest(user=user):
                self.denied("update public.ha_snapshots set revision=100;", user)
                self.denied("delete from public.ha_audit;", user)

    def test_storage_reads_are_fenced_despite_legacy_allow_all(self):
        for user, expected in ((ADMIN, 2), (EDITOR, 1), (VIEWER, 1), (UNASSIGNED, 0),
                               (RESIGNED_ADMIN, 0), (RESIGNED_EDITOR, 0), (MISSING_PROFILE, 0)):
            with self.subTest(user=user):
                self.successful("select count(*) from storage.objects where bucket_id='hospital-analytics';", expected, user)
        self.successful("select count(*) from storage.objects where bucket_id='hospital-analytics';", 0, None, "anon")

    def test_storage_inserts_allowed_only_for_editor_or_admin(self):
        for user in (EDITOR, ADMIN):
            with self.subTest(user=user):
                self.successful(f"insert into storage.objects(bucket_id,name) values('hospital-analytics','{NEW_OBJECT_A}'); select count(*) from storage.objects where name='{NEW_OBJECT_A}';", 1, user)
        for user in (VIEWER, UNASSIGNED, RESIGNED_ADMIN, RESIGNED_EDITOR, MISSING_PROFILE):
            with self.subTest(user=user):
                self.denied(f"insert into storage.objects(bucket_id,name) values('hospital-analytics','{NEW_OBJECT_A}');", user)
        self.denied(f"insert into storage.objects(bucket_id,name) values('hospital-analytics','{NEW_OBJECT_A}');", None, "anon")

    def test_storage_editor_cannot_insert_other_clinic(self):
        self.denied(f"insert into storage.objects(bucket_id,name) values('hospital-analytics','{NEW_OBJECT_B}');")

    def test_authenticated_storage_get_and_upload_operations_work(self):
        self.successful("set local storage.operation='storage.object.get_authenticated'; select count(*) from storage.objects where bucket_id='hospital-analytics';", 1)
        self.successful(f"set local storage.operation='storage.object.upload'; insert into storage.objects(bucket_id,name) values('hospital-analytics','{NEW_OBJECT_A}') returning name;", NEW_OBJECT_A)

    def test_storage_signed_download_issuance_denied_by_restrictive_fence(self):
        for operation in ('object.sign', 'storage.object.sign', 'object.sign_many', 'object.get_signed'):
            for user in (ADMIN, EDITOR, VIEWER):
                with self.subTest(operation=operation, user=user):
                    self.successful(f"set local storage.operation='{operation}'; select count(*) from storage.objects where bucket_id='hospital-analytics';", 0, user)

    def test_storage_signed_upload_issuance_denied_by_restrictive_fence(self):
        for operation in ('object.sign_upload_url', 'storage.object.sign_upload_url', 'object.upload_signed'):
            for user in (ADMIN, EDITOR):
                with self.subTest(operation=operation, user=user):
                    self.denied(f"set local storage.operation='{operation}'; insert into storage.objects(bucket_id,name) values('hospital-analytics','{NEW_OBJECT_A}');", user)

    def test_storage_missing_and_unknown_operation_fail_closed(self):
        for operation in ('', 'object.unknown', 'object', 'object.upload_extra'):
            with self.subTest(operation=operation):
                self.successful(f"set local storage.operation='{operation}'; select count(*) from storage.objects where bucket_id='hospital-analytics';", 0, ADMIN)
                self.denied(f"set local storage.operation='{operation}'; insert into storage.objects(bucket_id,name) values('hospital-analytics','{NEW_OBJECT_A}');", ADMIN)

    def test_storage_objects_immutable_even_with_legacy_update_delete(self):
        for user in (ADMIN, EDITOR, VIEWER, UNASSIGNED, RESIGNED_ADMIN):
            with self.subTest(user=user):
                self.successful("with changed as (update storage.objects set metadata='{}' where bucket_id='hospital-analytics' returning *) select count(*) from changed; with removed as (delete from storage.objects where bucket_id='hospital-analytics' returning *) select count(*) from removed;", "0\n0", user)

    def test_other_bucket_objects_cannot_move_into_private_bucket(self):
        self.denied(f"update storage.objects set bucket_id='hospital-analytics',name='{NEW_OBJECT_A}' where bucket_id='legacy';", ADMIN)

    def test_legacy_bucket_behavior_preserved(self):
        self.successful("insert into storage.objects(bucket_id,name) values('legacy','new'); update storage.objects set name='changed' where name='new'; with removed as (delete from storage.objects where name='changed' returning *) select count(*) from removed; select count(*) from storage.objects where bucket_id='legacy';", "1\n1", None, "anon")

    def test_bucket_is_private_and_size_limited(self):
        self.assertEqual(DB.checked("select public,file_size_limit from storage.buckets where id='hospital-analytics';"), "f|52428800")

    def test_malformed_paths_never_gain_access(self):
        for path in ("", "../escape", f"{CLINIC_A}/snapshots/../../secret.zip", OBJECT_A.upper(),
                     OBJECT_A + "/secret", OBJECT_A.replace("snapshots", "unknown"), OBJECT_A.replace(".zip", ".html")):
            with self.subTest(path=path):
                self.successful(f"select public.ha_object_clinic('{path}') is null;", "t")
                self.denied(f"insert into storage.objects(bucket_id,name) values('hospital-analytics','{path}');", ADMIN)

    def test_editor_commit_advances_revision_and_records_actor(self):
        self.successful(commit_sql() + f"select revision,object_path,sha256,updated_by from public.ha_snapshots where clinic_id='{CLINIC_A}';", f"1\n1|{OBJECT_A}|{CHECKSUM}|{EDITOR}")

    def test_admin_commit_allowed_without_assignment(self):
        self.successful(commit_sql(CLINIC_B, path=OBJECT_B), 1, ADMIN)

    def test_commit_denied_for_viewer_unassigned_resigned_missing_profile(self):
        for user in (VIEWER, UNASSIGNED, RESIGNED_ADMIN, RESIGNED_EDITOR, MISSING_PROFILE):
            with self.subTest(user=user):
                self.denied(commit_sql(), user)
        self.denied(commit_sql(CLINIC_B, path=OBJECT_B))

    def test_commit_rejects_invalid_path_hash_or_absent_object(self):
        for path, checksum in ((None, CHECKSUM), (OBJECT_B, CHECKSUM), (NEW_OBJECT_A, CHECKSUM),
                               (OBJECT_A.replace("000000000001.zip", "000000000099.zip"), CHECKSUM),
                               (OBJECT_A, None), (OBJECT_A, "bad"), (OBJECT_A, "A" * 64)):
            with self.subTest(path=path, checksum=checksum):
                self.denied(commit_sql(path=path, checksum=checksum), code="22023")

    def test_stale_revision_cannot_overwrite(self):
        self.denied(commit_sql() + commit_sql(), code="40001")
        self.denied(commit_sql(expected=-1), code="40001")
        self.denied(commit_sql(expected="null"), code="40001")

    def test_membership_revocation_is_effective_next_statement(self):
        source = (f"begin; delete from public.ha_memberships where user_id='{EDITOR}'; "
                  f"set local role authenticated; set local request.jwt.claim.sub='{EDITOR}'; set local storage.operation='object.get_authenticated'; "
                  "select count(*) from public.ha_clinics; select count(*) from storage.objects where bucket_id='hospital-analytics'; rollback;")
        self.assertEqual(DB.checked(source), "0\n0")

    def test_resignation_is_effective_next_statement(self):
        source = (f"begin; update public.profiles set resigned_at=now() where id='{ADMIN}'; "
                  f"set local role authenticated; set local request.jwt.claim.sub='{ADMIN}'; set local storage.operation='object.get_authenticated'; "
                  "select count(*) from public.ha_clinics; select count(*) from storage.objects where bucket_id='hospital-analytics'; rollback;")
        self.assertEqual(DB.checked(source), "0\n0")

    def test_retired_employee_cannot_reactivate_self(self):
        self.denied(f"update public.profiles set resigned_at=null where id='{RESIGNED_EDITOR}';", RESIGNED_EDITOR)

    def test_retired_admin_cannot_reactivate_self_or_another_admin(self):
        for target in (RESIGNED_ADMIN, RESIGNED_EDITOR):
            with self.subTest(target=target):
                self.denied(f"update public.profiles set resigned_at=null where id='{target}';", RESIGNED_ADMIN)

    def test_retired_admin_cannot_promote_an_employee(self):
        self.denied(f"update public.profiles set role='admin' where id='{EDITOR}';", RESIGNED_ADMIN)

    def test_active_employee_cannot_change_authorization_fields(self):
        for change in ("role='admin'", "resigned_at=now()", f"id='{MISSING_PROFILE}'"):
            with self.subTest(change=change):
                self.denied(f"update public.profiles set {change} where id='{EDITOR}';")

    def test_active_admin_can_manage_employee_lifecycle(self):
        self.successful(f"update public.profiles set resigned_at=null where id='{RESIGNED_EDITOR}'; "
                        f"select public.ha_can_access('{CLINIC_A}'); "
                        f"update public.profiles set role='admin' where id='{EDITOR}'; "
                        f"select role from public.profiles where id='{EDITOR}';", "t\nadmin", ADMIN)

    def test_employee_can_still_edit_display_name(self):
        self.successful(f"update public.profiles set display_name='Updated' where id='{EDITOR}'; "
                        f"select display_name from public.profiles where id='{EDITOR}';", "Updated")

    def test_database_owner_can_manage_profiles_without_user_jwt(self):
        self.assertEqual(DB.checked(f"begin; set local request.jwt.claim.sub=''; "
                                   f"update public.profiles set resigned_at=null where id='{RESIGNED_EDITOR}'; "
                                   f"select resigned_at is null from public.profiles where id='{RESIGNED_EDITOR}'; rollback;"), "t")

    def test_profile_trigger_not_directly_callable(self):
        self.successful("select has_function_privilege('authenticated', 'public.ha_guard_profile_authorization()', 'execute');", "f")

    def test_supabase_default_function_grants_do_not_expose_writes_or_triggers(self):
        self.assertEqual(DB.checked("select has_function_privilege('anon', 'public.ha_commit_snapshot(uuid,bigint,text,text)', 'execute');"), "f")
        for role in ('anon','authenticated'):
            for function in ('ha_initialize_clinic','ha_membership_audit'):
                with self.subTest(role=role,function=function):
                    self.assertEqual(DB.checked(f"select has_function_privilege('{role}', 'public.{function}()', 'execute');"), "f")

    def test_z_concurrent_commits_only_one_wins(self):
        # The first writer holds the row lock until the second is observably blocked.
        first = subprocess.Popen(DB.psql_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                 **hidden_process_options())
        second = None
        try:
            first.stdin.write(as_user(commit_sql() + "select pg_advisory_lock(5483101); select pg_sleep(10);", rollback=False))
            first.stdin.close()
            deadline = time.monotonic() + 8
            while time.monotonic() < deadline:
                if DB.checked("select count(*) from pg_locks where locktype='advisory' and objid=5483101 and granted;") == "1":
                    break
                time.sleep(0.05)
            else:
                self.fail("First writer did not acquire its synchronization lock")
            second = subprocess.Popen(DB.psql_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                      **hidden_process_options())
            second.stdin.write(as_user(commit_sql(), rollback=False))
            second.stdin.close()
            deadline = time.monotonic() + 6
            while time.monotonic() < deadline:
                if DB.checked("select count(*) from pg_stat_activity where wait_event_type='Lock' and query like 'select public.ha_commit_snapshot%';") == "1":
                    break
                time.sleep(0.05)
            else:
                self.fail("Second writer never blocked on the concurrent revision update")
            first.wait(timeout=15)
            second.wait(timeout=15)
            self.assertEqual(first.returncode, 0, first.stderr.read())
            self.assertNotEqual(second.returncode, 0)
            self.assertIn("40001", second.stderr.read())
            self.assertEqual(DB.checked(f"select revision from public.ha_snapshots where clinic_id='{CLINIC_A}'; select count(*) from public.ha_audit where action='snapshot.committed';"), "1\n1")
        finally:
            for process in (first, second):
                if process is not None:
                    if process.poll() is None:
                        process.kill()
                        process.wait()
                    process.stdout.close()
                    process.stderr.close()


def fixture():
    DB.checked("""
        create role anon nologin;
        create role authenticated nologin;
        -- Supabase grants function execution explicitly to API roles by default.
        alter default privileges in schema public grant execute on functions to anon,authenticated;
        create schema auth;
        create schema storage;
        create table auth.users(id uuid primary key);
        create table public.profiles(id uuid primary key references auth.users(id), role text not null, resigned_at timestamptz, display_name text);
        create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
        -- Model Supabase's operation-aware helpers without any external service.
        -- Both fully qualified and short names normalize to the same exact name.
        create function storage.allow_only_operation(operation text) returns boolean language sql stable as
        $$ select coalesce(nullif(regexp_replace(current_setting('storage.operation',true),'^storage\\.',''),'')
            = nullif(regexp_replace(operation,'^storage\\.',''),''),false) $$;
        create function storage.allow_any_operation(operations text[]) returns boolean language sql stable as
        $$ select coalesce(bool_or(storage.allow_only_operation(op)),false) from unnest(operations) as op $$;
        grant usage on schema auth,storage to anon,authenticated;
        -- Reproduce the relevant live ERP profile policies measured 2026-10-19.
        -- The existing role guard does not protect resigned_at or retired admins.
        alter table public.profiles enable row level security;
        grant select,update on public.profiles to authenticated;
        create policy profile_read on public.profiles for select using (auth.uid() is not null);
        create policy profile_self_update on public.profiles for update using (auth.uid()=id);
        create policy profile_admin_update on public.profiles for update using
          (exists(select 1 from public.profiles p where p.id=auth.uid() and p.role='admin'));
        create function public.protect_admin_fields() returns trigger language plpgsql security definer set search_path='' as $$
        begin
          if not exists(select 1 from public.profiles where id=auth.uid() and role='admin')
             and new.role is distinct from old.role then
            raise exception 'Only admin can update role';
          end if;
          return new;
        end $$;
        create trigger protect_profile_admin_fields before update on public.profiles
        for each row execute function public.protect_admin_fields();
        create table storage.buckets(id text primary key,name text not null,public boolean default false,file_size_limit bigint);
        create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null references storage.buckets(id),name text not null,metadata jsonb,unique(bucket_id,name));
        alter table storage.objects enable row level security;
        grant select,insert,update,delete on storage.objects to anon,authenticated;
        create policy legacy_allow_everything on storage.objects for all to public using (true) with check (true);
        insert into storage.buckets(id,name) values('legacy','legacy');
        insert into storage.objects(bucket_id,name) values('legacy','old');
    """)
    DB.checked(PROFILE_GUARD.read_text(encoding="utf-8"))
    DB.checked(MIGRATION.read_text(encoding="utf-8"))
    DB.checked(FUNCTION_GRANTS.read_text(encoding="utf-8"))
    users = (ADMIN, EDITOR, VIEWER, UNASSIGNED, RESIGNED_ADMIN, RESIGNED_EDITOR, MISSING_PROFILE)
    DB.checked("insert into auth.users(id) values " + ",".join(f"('{u}')" for u in users) + ";")
    DB.checked("insert into public.profiles(id,role,resigned_at) values " + ",".join(
        f"('{u}','{'admin' if u in (ADMIN, RESIGNED_ADMIN) else 'employee'}',"
        f"{'now()' if u in (RESIGNED_ADMIN, RESIGNED_EDITOR) else 'null'})" for u in users[:-1]) + ";")
    DB.checked(f"""
        set request.jwt.claim.sub='{ADMIN}';
        insert into public.ha_clinics(id,name,created_by) values
          ('{CLINIC_A}','Synthetic A','{ADMIN}'),('{CLINIC_B}','Synthetic B','{ADMIN}');
        insert into public.ha_memberships(clinic_id,user_id,role) values
          ('{CLINIC_A}','{EDITOR}','editor'),('{CLINIC_A}','{VIEWER}','viewer'),
          ('{CLINIC_A}','{RESIGNED_EDITOR}','editor'),('{CLINIC_A}','{MISSING_PROFILE}','editor');
        insert into storage.objects(bucket_id,name) values
          ('hospital-analytics','{OBJECT_A}'),('hospital-analytics','{OBJECT_B}');
    """)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--postgres-bin", default=os.environ.get("ANALYTICS_TEST_POSTGRES_BIN"))
    parser.add_argument("--port", type=int, default=54831)
    args, remaining = parser.parse_known_args()
    binaries = args.postgres_bin or (str(Path(shutil.which("pg_ctl")).parent) if shutil.which("pg_ctl") else None)
    if not binaries:
        parser.error("Supply --postgres-bin or ANALYTICS_TEST_POSTGRES_BIN (existing local PostgreSQL binaries).")
    DB = LocalPostgres(binaries, args.port)
    try:
        DB.start()
        print("Synthetic cluster:", DB.work, flush=True)
        print("PostgreSQL:", DB.checked("select version();"), flush=True)
        print("Migration SHA256:", hashlib.sha256(MIGRATION.read_bytes()).hexdigest(), flush=True)
        fixture()
        # stdout keeps successful logs from becoming PowerShell native stderr errors.
        program = unittest.main(argv=[__file__, *remaining], exit=False,
                                testRunner=unittest.TextTestRunner(stream=sys.stdout, verbosity=2))
        raise SystemExit(0 if program.result.wasSuccessful() else 1)
    finally:
        DB.stop()
