-- 일반 직원의 attendance 직접 INSERT/UPDATE 차단. 쓰기는 서버 API(service_role)만 한다.
-- 조회 정책과 admin/leader 정책은 유지한다. 테이블 권한 REVOKE는 하지 않는다.
-- 적용 전제: SUPABASE_SERVICE_ROLE_KEY가 운영에 설정되고 새 API 코드가 배포·검증된 상태.
drop policy if exists "Users can insert own attendance" on public.attendance;
drop policy if exists "Users can update own attendance" on public.attendance;
