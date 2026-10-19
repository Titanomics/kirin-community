"""Tab-level access against isolated real PostgreSQL, never production."""
import argparse
from pathlib import Path
import sys
import unittest
import test_sql_security as legacy
from test_sql_security import ADMIN, EDITOR, VIEWER, UNASSIGNED, RESIGNED_ADMIN, RESIGNED_EDITOR, MISSING_PROFILE, CLINIC_A, CLINIC_B, OBJECT_B, as_user, commit_sql

DB=None
MIGRATION=Path(__file__).resolve().parents[2]/'supabase/migrations/20261019140344_hospital_analytics_tab_access.sql'

class TabAccessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if DB is None: raise unittest.SkipTest('Run directly with --postgres-bin')
    def ok(self,sql,expected,user=EDITOR,role='authenticated'):
        self.assertEqual(DB.checked(as_user(sql,user,role)),str(expected))
    def denied(self,sql,user=EDITOR,role='authenticated'):
        result=DB.sql(as_user(sql,user,role))
        self.assertNotEqual(result.returncode,0)
        self.assertIn('42501',result.stderr)
    def test_tab_grant_includes_all_existing_clinics(self):
        self.ok('select count(*) from public.ha_clinics; select count(*) from public.ha_snapshots;', '2\n2')
        self.ok(commit_sql(CLINIC_B,path=OBJECT_B),1)
    def test_future_clinics_need_no_employee_assignment(self):
        self.ok(f"set local role postgres; insert into public.ha_clinics(name,created_by) values('New','{ADMIN}'); set local role authenticated; select count(*) from public.ha_clinics;",3)
    def test_tab_access_does_not_depend_on_clinic_count(self):
        self.ok('set local role postgres; delete from public.ha_memberships; delete from public.ha_audit; delete from public.ha_snapshots; delete from public.ha_clinics; set local role authenticated; select public.ha_tab_access(); select count(*) from public.ha_clinics;','t\n0')
    def test_legacy_per_clinic_membership_no_longer_grants_tab(self):
        self.ok('select public.ha_tab_access(); select count(*) from public.ha_clinics;','f\n0',VIEWER)
    def test_unselected_resigned_missing_users_are_denied(self):
        for uid in (VIEWER,UNASSIGNED,RESIGNED_ADMIN,RESIGNED_EDITOR,MISSING_PROFILE):
            with self.subTest(uid=uid):
                self.ok('select public.ha_tab_access(); select count(*) from public.ha_snapshots;', 'f\n0',uid)
                self.denied(commit_sql(),uid)
    def test_only_admin_can_assign_or_remove_tab_access(self):
        self.denied(f"insert into public.ha_tab_memberships(user_id) values('{UNASSIGNED}');")
        self.ok("with removed as (delete from public.ha_tab_memberships returning user_id) select count(*) from removed;",0)
        self.ok(f"insert into public.ha_tab_memberships(user_id) values('{UNASSIGNED}'); select count(*) from public.ha_tab_memberships where user_id='{UNASSIGNED}';",1,ADMIN)
        self.denied(f"insert into public.ha_tab_memberships(user_id) values('{UNASSIGNED}');",RESIGNED_ADMIN)
    def test_ordinary_employee_cannot_read_other_grants_or_audit(self):
        self.ok('select count(*) from public.ha_tab_memberships; select count(*) from public.ha_tab_access_audit;', '1\n0')
    def test_revoke_denies_all_clinics_and_storage_next_statement(self):
        self.ok(f"set local role postgres; delete from public.ha_tab_memberships where user_id='{EDITOR}'; set local role authenticated; select public.ha_tab_access(); select count(*) from public.ha_clinics; select count(*) from storage.objects where bucket_id='hospital-analytics';",'f\n0\n0')
    def test_storage_only_selected_users_read_and_write(self):
        self.ok("select count(*) from storage.objects where bucket_id='hospital-analytics';",2)
        self.ok("select count(*) from storage.objects where bucket_id='hospital-analytics';",0,VIEWER)
        self.denied(f"insert into storage.objects(bucket_id,name) values('hospital-analytics','{CLINIC_B}/uploads/20000000-0000-4000-8000-000000000003.xlsx');",VIEWER)
    def test_unknown_clinic_is_denied_even_for_selected_user(self):
        self.ok("select public.ha_can_access('90000000-0000-4000-8000-000000000001');",'f')
    def test_selected_employee_cannot_delete_or_replace_immutable_objects(self):
        self.ok("with changed as (delete from storage.objects where bucket_id='hospital-analytics' returning id) select count(*) from changed;",0)
        self.ok("with changed as (update storage.objects set name='changed' where bucket_id='hospital-analytics' returning id) select count(*) from changed;",0)
    def test_selected_employee_cannot_issue_signed_downloads(self):
        self.ok("set local storage.operation='object.sign'; select count(*) from storage.objects where bucket_id='hospital-analytics';",0)
    def test_selected_employee_cannot_write_snapshot_pointer_or_audit_directly(self):
        self.denied('update public.ha_snapshots set revision=999;')
        self.denied(f"insert into public.ha_tab_access_audit(user_id,action) values('{EDITOR}','granted');",ADMIN)
    def test_selected_employee_cannot_self_promote_or_restore_retired_account(self):
        self.denied(f"update public.profiles set role='admin' where id='{EDITOR}';")
        self.denied(f"update public.profiles set resigned_at=null where id='{RESIGNED_EDITOR}';",RESIGNED_EDITOR)
    def test_admin_access_does_not_require_assignment(self):
        self.ok('select public.ha_tab_access(); select count(*) from public.ha_clinics;', 't\n2',ADMIN)
    def test_anonymous_has_no_table_write_or_audit_privilege(self):
        self.ok('select public.ha_tab_access();','f',None,'anon')
        self.denied('select * from public.ha_tab_memberships;',None,'anon')
        self.denied('select * from public.ha_tab_access_audit;',None,'anon')
        self.ok("select has_function_privilege('anon','public.ha_audit_tab_access()','execute'); select has_function_privilege('authenticated','public.ha_audit_tab_access()','execute');",'f\nf',ADMIN)
    def test_grant_and_revoke_record_admin_actor(self):
        self.ok(f"insert into public.ha_tab_memberships(user_id) values('{UNASSIGNED}'); delete from public.ha_tab_memberships where user_id='{UNASSIGNED}'; select string_agg(action,',' order by id) from public.ha_tab_access_audit where user_id='{UNASSIGNED}' and actor_id='{ADMIN}';",'granted,revoked',ADMIN)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--postgres-bin',required=True)
    args,rest=parser.parse_known_args()
    DB=legacy.LocalPostgres(args.postgres_bin,54832);legacy.DB=DB
    try:
        DB.start();legacy.fixture()
        if MIGRATION.exists():
            DB.checked(MIGRATION.read_text('utf8'))
            DB.checked(f"set request.jwt.claim.sub='{ADMIN}'; insert into public.ha_tab_memberships(user_id) values('{EDITOR}'),('{RESIGNED_EDITOR}'),('{MISSING_PROFILE}');")
        result=unittest.main(argv=[__file__,*rest],exit=False,testRunner=unittest.TextTestRunner(stream=sys.stdout,verbosity=2))
        raise SystemExit(0 if result.result.wasSuccessful() else 1)
    finally: DB.stop()
