import test from 'node:test';
import assert from 'node:assert/strict';
import { isMobileHeaders, resolveIpPolicy } from '../../lib/attendance/policy.ts';

function headers(map) {
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => lower[name.toLowerCase()] ?? null };
}

const PC_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

test('isMobileHeaders: sec-ch-ua-mobile ?1 이면 모바일', () => {
  assert.equal(isMobileHeaders(headers({ 'sec-ch-ua-mobile': '?1', 'user-agent': PC_CHROME_UA })), true);
});

test('isMobileHeaders: sec-ch-ua-platform Android/iOS 이면 모바일', () => {
  assert.equal(isMobileHeaders(headers({ 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Android"', 'user-agent': PC_CHROME_UA })), true);
  assert.equal(isMobileHeaders(headers({ 'sec-ch-ua-platform': '"iOS"' })), true);
});

test('isMobileHeaders: Client Hints 없으면 UA로 폴백', () => {
  assert.equal(isMobileHeaders(headers({ 'user-agent': ANDROID_UA })), true);
  assert.equal(isMobileHeaders(headers({ 'user-agent': IPHONE_UA })), true);
});

test('isMobileHeaders: PC 크롬은 모바일 아님', () => {
  assert.equal(isMobileHeaders(headers({ 'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"', 'user-agent': PC_CHROME_UA })), false);
});

test('isMobileHeaders: 헤더가 전혀 없으면 모바일 아님 (소프트 가드)', () => {
  assert.equal(isMobileHeaders(headers({})), false);
});

test('resolveIpPolicy: 정확히 일치하는 IP 허용', () => {
  assert.deepEqual(resolveIpPolicy('1.2.3.4', '1.2.3.4, 5.6.7.8', 'production'), { allowed: true, configured: true });
  assert.deepEqual(resolveIpPolicy('9.9.9.9', '1.2.3.4, 5.6.7.8', 'production'), { allowed: false, configured: true });
});

test('resolveIpPolicy: 끝이 점이면 대역 prefix 매칭', () => {
  assert.equal(resolveIpPolicy('192.168.0.77', '192.168.0.', 'production').allowed, true);
  assert.equal(resolveIpPolicy('192.168.1.77', '192.168.0.', 'production').allowed, false);
});

test('resolveIpPolicy: 운영에서 허용목록 비어 있으면 거부 + configured false', () => {
  assert.deepEqual(resolveIpPolicy('1.2.3.4', undefined, 'production'), { allowed: false, configured: false });
  assert.deepEqual(resolveIpPolicy('1.2.3.4', '  ', 'production'), { allowed: false, configured: false });
});

test('resolveIpPolicy: 운영이 아니면 허용목록 비어 있어도 허용', () => {
  assert.deepEqual(resolveIpPolicy('1.2.3.4', undefined, undefined), { allowed: true, configured: false });
  assert.deepEqual(resolveIpPolicy('1.2.3.4', '', 'preview'), { allowed: true, configured: false });
});
