import { createClient } from '@/lib/supabase/server';

export type Clinic = { id: string; name: string; emr: string; owner: string; created_at: string };
export type MemberRole = 'editor' | 'viewer';
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
  const { data: clinics, error: clinicError } = await client.from('ha_clinics').select('id,name,emr,owner,created_at').order('created_at');
  if (clinicError) throw new AnalyticsError('병원 분석 저장소 연결을 준비 중입니다.');
  const { data: memberships, error: memberError } = await client.from('ha_memberships').select('clinic_id,role').eq('user_id', user.id);
  if (memberError) throw new AnalyticsError('병원별 권한을 확인하지 못했습니다.');
  const roles: Record<string, MemberRole> = {};
  for (const row of memberships ?? []) if (row.role === 'editor' || row.role === 'viewer') roles[row.clinic_id] = row.role;
  const visible = (clinics as Clinic[]).filter(clinic => isAdmin || roles[clinic.id]);
  return { client, user, profile, isAdmin, clinics: visible, roles, checkedAt: new Date().toISOString() };
}

export type AnalyticsAccess = Awaited<ReturnType<typeof readAccess>>;
export function requireClinic(access: AnalyticsAccess, id: string, writing = false) {
  if (!validId(id)) throw new AnalyticsError('병원 식별자를 확인해 주세요.', 400);
  const clinic = access.clinics.find(item => item.id === id);
  if (!clinic || (!access.isAdmin && (!access.roles[id] || (writing && access.roles[id] !== 'editor')))) throw new AnalyticsError('이 병원에 대한 접근 권한이 없습니다.', 403);
  return clinic;
}
export function requireAdmin(access: AnalyticsAccess) {
  if (!access.isAdmin) throw new AnalyticsError('관리자만 담당자를 지정할 수 있습니다.', 403);
}
export function publicAccess(access: AnalyticsAccess) {
  return { clinics: access.clinics, roles: access.roles, isAdmin: access.isAdmin, checkedAt: access.checkedAt,
    user: { id: access.user.id, name: access.profile.display_name || 'ERP 사용자', role: access.isAdmin ? 'admin' : 'user', version: 1 } };
}
