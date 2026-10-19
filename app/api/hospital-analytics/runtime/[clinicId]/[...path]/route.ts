import { NextRequest, NextResponse } from 'next/server';
import { gzipSync } from 'node:zlib';
import { AnalyticsError, readAccess, requireClinic } from '@/lib/hospital-analytics/access';
import { body, failure, privateHeaders } from '@/lib/hospital-analytics/http';
import { ENGINE_VERSION } from '@/lib/hospital-analytics/version';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
type Context = { params: Promise<{ clinicId: string; path: string[] }> };
async function proxy(request: NextRequest, context: Context) {
  try {
    const { clinicId, path } = await context.params;
    if (path.some(part => !part || part === '.' || part === '..' || /[\\%?#]/.test(part))) throw new AnalyticsError('지원하지 않는 경로입니다.', 400);
    const payload = request.method === 'POST' ? await body(request) : undefined;
    const access = await readAccess(); requireClinic(access, clinicId, request.method === 'POST');
    const session = await access.client.auth.getSession();
    if (session.error || !session.data.session?.access_token) throw new AnalyticsError('ERP 로그인이 필요합니다.', 401);
    // Use trusted deployment configuration, never a caller-supplied Host or URL.
    const deploymentHost = process.env.VERCEL_AUTOMATION_BYPASS_SECRET && process.env.VERCEL_URL ? process.env.VERCEL_URL : process.env.VERCEL_ENV === 'production'
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL || 'kirin-community.vercel.app'
      : process.env.VERCEL_URL;
    const endpoint = deploymentHost ? `https://${deploymentHost}/api/analytics_runtime` : process.env.HA_RUNTIME_URL;
    if (!endpoint || (!process.env.VERCEL_URL && (process.env.NODE_ENV === 'production' || !/^http:\/\/127\.0\.0\.1:\d+\/api\/analytics_runtime$/.test(endpoint)))) throw new AnalyticsError('온라인 분석 엔진 연결을 준비 중입니다.');
    const upstream = await fetch(endpoint, {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(280_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.data.session.access_token}`, 'X-HA-Engine-Version': ENGINE_VERSION, ...(request.headers.get('cookie') ? { Cookie: request.headers.get('cookie')! } : {}), ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) },
      body: JSON.stringify({ clinic: clinicId, method: request.method, path: '/' + path.join('/') + request.nextUrl.search, payload, identity: request.headers.get('x-operator-identity') || undefined }),
    });
    if (upstream.headers.get('x-ha-engine-version') !== ENGINE_VERSION) throw new AnalyticsError('배포된 화면과 분석 엔진의 버전이 일치하지 않습니다. 현재 배포 연결을 확인해야 합니다.');
    let bytes: Uint8Array = new Uint8Array(await upstream.arrayBuffer());
    const kind = upstream.headers.get('content-type') || 'application/octet-stream';
    if (!/^(application\/json|text\/|application\/vnd\.|application\/octet-stream|image\/svg\+xml)/.test(kind)) throw new AnalyticsError('분석 응답을 확인하지 못했습니다.');
    const storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim()).origin;
    const headers = new Headers({ ...privateHeaders, 'Content-Type': kind, 'Content-Security-Policy': upstream.headers.get('content-security-policy') || `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self' ${storageOrigin}; object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'` });
    const disposition = upstream.headers.get('content-disposition'); if (disposition) headers.set('Content-Disposition', disposition);
    if (bytes.length > 16384) { bytes = new Uint8Array(gzipSync(bytes)); headers.set('Content-Encoding', 'gzip'); }
    if (bytes.length > 4 * 1024 * 1024) throw new AnalyticsError('보고서 범위를 줄여 다시 열어 주세요.', 413);
    return new NextResponse(bytes as BodyInit, { status: upstream.status, headers });
  } catch (error) { return failure(error); }
}
export const GET = proxy;
export const POST = proxy;
