import { NextRequest } from 'next/server';
import { AnalyticsError, readAccess, requireAdmin, requireClinic, validId } from '@/lib/hospital-analytics/access';
import { body, json, failure } from '@/lib/hospital-analytics/http';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const access = await readAccess(); requireAdmin(access);
    const [people, members] = await Promise.all([
      access.client.from('profiles').select('id,display_name,email,role').is('resigned_at', null).order('display_name'),
      access.client.from('ha_memberships').select('clinic_id,user_id,role,updated_at'),
    ]);
    if (people.error || members.error) throw new AnalyticsError('담당자 목록을 확인하지 못했습니다.');
    return json({ people: people.data, memberships: members.data, checkedAt: new Date().toISOString() });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const data = await body(request, 8192); const access = await readAccess(); requireAdmin(access);
    if (data.action === 'create-clinic') {
      if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 120 || typeof data.owner !== 'string' || data.owner.length > 100 || !['dentweb', 'ysarang', 'other'].includes(String(data.emr))) throw new AnalyticsError('병원명과 EMR을 확인해 주세요.', 400);
      // INSERT RETURNING runs the read policy before its STABLE clinic lookup
      // can see the new row. Return our ID after a successful minimal insert.
      const id = crypto.randomUUID();
      const result = await access.client.from('ha_clinics').insert({ id, name: data.name.trim(), emr: data.emr, owner: data.owner.trim(), created_by: access.user.id });
      if (result.error) throw new AnalyticsError('병원 공간을 만들지 못했습니다.');
      return json({ id }, 201);
    }
    if (data.action === 'set-member') {
      if (!validId(data.clinicId) || !validId(data.userId) || !['editor', 'viewer', 'revoke'].includes(String(data.role))) throw new AnalyticsError('병원·담당자·권한을 확인해 주세요.', 400);
      requireClinic(access, data.clinicId);
      const { data: person, error: personError } = await access.client.from('profiles').select('id,role,resigned_at').eq('id', data.userId).single();
      if (personError || !person || person.resigned_at) throw new AnalyticsError('사용 중인 ERP 계정을 선택해 주세요.', 400);
      if (person.role === 'admin') throw new AnalyticsError('관리자는 모든 병원에 접근할 수 있습니다.', 400);
      const result = data.role === 'revoke'
        ? await access.client.from('ha_memberships').delete().eq('clinic_id', data.clinicId).eq('user_id', data.userId)
        : await access.client.from('ha_memberships').upsert({ clinic_id: data.clinicId, user_id: data.userId, role: data.role }, { onConflict: 'clinic_id,user_id' });
      if (result.error) throw new AnalyticsError('담당자 권한을 변경하지 못했습니다.');
      return json({ ok: true, checkedAt: new Date().toISOString() });
    }
    throw new AnalyticsError('지원하지 않는 관리 작업입니다.', 400);
  } catch (error) { return failure(error); }
}
