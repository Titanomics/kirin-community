import { createClient } from '@/lib/supabase/server';

export type Clinic = { id: string; name: string; emr: string; owner: string; created_at: string };
export class AnalyticsError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
export const validId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export async function readAccess() {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new AnalyticsError('ERP 로그인이 필요합니다.', 401);
  const { data: profile, error } = await client.from('profiles').select('id,display_name,role,resigned_at').eq('id', user.id).single();
  if (error) throw new AnalyticsError('ERP 계정 권한을 확인하지 못했습니다.');
  if (!profile || profile.resigned_at) throw new AnalyticsError('현재 계정은 접근할 수 없습니다.', 403);
  const isAdmin = profile.role === 'admin';
  const { data: memberships, error: memberError } = await client.from('ha_tab_memberships').select('user_id').eq('user_id', user.id);
  if (memberError) throw new AnalyticsError('병원 분석 탭 권한을 확인하지 못했습니다.');
  const canAccessTab = isAdmin || memberships?.length === 1;
  const { data: clinics, error: clinicError } = await client.from('ha_clinics').select('id,name,emr,owner,created_at').order('created_at');
  if (clinicError) throw new AnalyticsError('병원 분석 저장소 연결을 준비 중입니다.');
  return { client, user, profile, isAdmin, canAccessTab, clinics: canAccessTab ? clinics as Clinic[] : [], checkedAt: new Date().toISOString() };
}

export type AnalyticsAccess = Awaited<ReturnType<typeof readAccess>>;
export function requireClinic(access: AnalyticsAccess, id: string) {
  if (!validId(id)) throw new AnalyticsError('병원 식별자를 확인해 주세요.', 400);
  const clinic = access.clinics.find(item => item.id === id);
  if (!access.canAccessTab || !clinic) throw new AnalyticsError('병원 분석 접근 권한이 없습니다.', 403);
  return clinic;
}
export function requireAdmin(access: AnalyticsAccess) {
  if (!access.isAdmin) throw new AnalyticsError('관리자만 병원 분석 탭 접근자를 지정할 수 있습니다.', 403);
}
export function publicAccess(access: AnalyticsAccess) {
  return { clinics: access.clinics, canAccessTab: access.canAccessTab, isAdmin: access.isAdmin, checkedAt: access.checkedAt,
    user: { id: access.user.id, name: access.profile.display_name || 'ERP 사용자', role: access.isAdmin ? 'admin' : 'user', version: 1 } };
}
