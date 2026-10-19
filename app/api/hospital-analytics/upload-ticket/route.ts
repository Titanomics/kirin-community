import { NextRequest } from 'next/server';
import { AnalyticsError, readAccess, requireClinic, validId } from '@/lib/hospital-analytics/access';
import { body, json, failure } from '@/lib/hospital-analytics/http';
export async function POST(request: NextRequest) {
  try {
    const data = await body(request, 2048); const access = await readAccess();
    if (!validId(data.clinicId) || typeof data.size !== 'number' || !Number.isSafeInteger(data.size) || data.size <= 0 || data.size > 25 * 1024 * 1024) throw new AnalyticsError('25MB 이하의 파일을 선택해 주세요.', 400);
    requireClinic(access, data.clinicId);
    const path = `${data.clinicId}/uploads/${crypto.randomUUID()}.xlsx`;
    const session = await access.client.auth.getSession();
    if (session.error || !session.data.session?.access_token) throw new AnalyticsError('ERP 로그인이 필요합니다.', 401);
    // Use the existing user's JWT, so RLS rechecks membership at the actual upload.
    // A signed upload URL would remain usable for two hours after revocation.
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim().replace(/\/$/, '');
    return json({ path, url: `${base}/storage/v1/object/hospital-analytics/${path}`, accessToken: session.data.session.access_token, publicKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim() });
  } catch (error) { return failure(error); }
}
