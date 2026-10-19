import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsError } from './access';

export const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
export function json(value: unknown, status = 200) { return NextResponse.json(value, { status, headers: privateHeaders }); }
export function failure(error: unknown) {
  return json({ error: error instanceof AnalyticsError ? error.message : '분석 요청을 처리하지 못했습니다.' }, error instanceof AnalyticsError ? error.status : 503);
}
export async function body(request: NextRequest, maxBytes = 3 * 1024 * 1024) {
  // Next's local server can normalize nextUrl.host to localhost even when the
  // browser requested 127.0.0.1. Host is browser-controlled, not a JS-settable header.
  const expectedOrigin = new URL(request.nextUrl.origin);
  expectedOrigin.host = request.headers.get('host') || expectedOrigin.host;
  if (request.headers.get('origin') !== expectedOrigin.origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new AnalyticsError('ERP 화면에서 다시 요청해 주세요.', 403);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new AnalyticsError('지원하지 않는 요청 형식입니다.', 415);
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new AnalyticsError('파일은 업로드 기능으로 전송해 주세요.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AnalyticsError('요청 내용이 없습니다.', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new AnalyticsError('요청 크기를 줄여 주세요.', 413); }
    chunks.push(value);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new AnalyticsError('요청 내용을 확인해 주세요.', 400); }
}
