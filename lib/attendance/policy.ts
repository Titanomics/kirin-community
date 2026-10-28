// 출퇴근 요청 판정 순수 함수. 브라우저·서버 양쪽에서 import 가능 (DOM/Node API 사용 금지).

export interface HeaderReader {
  get(name: string): string | null;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|Opera Mini|IEMobile/i;
const MOBILE_PLATFORMS = new Set(['"Android"', '"iOS"']);

// Chromium 계열은 저엔트로피 Client Hints를 HTTPS 요청에 기본 제공한다 (생략될 수 있음).
// Safari·Firefox는 보내지 않으므로 UA로 폴백한다. 헤더 부재는 PC라는 증거가 아니다 (소프트 가드).
export function isMobileHeaders(headers: HeaderReader): boolean {
  if (headers.get('sec-ch-ua-mobile') === '?1') return true;
  const platform = headers.get('sec-ch-ua-platform');
  if (platform && MOBILE_PLATFORMS.has(platform.trim())) return true;
  return MOBILE_UA.test(headers.get('user-agent') || '');
}

export interface IpPolicy {
  allowed: boolean;
  configured: boolean; // 허용목록 환경변수가 설정되어 있는지
}

// allowedEnv: ALLOWED_ATTENDANCE_IPS ("1.2.3.4, 192.168.0." 형식. 끝이 '.'이면 prefix 매칭)
// vercelEnv: VERCEL_ENV. 'production'에서 허용목록이 비어 있으면 거부(fail-closed). 그 외는 개발 편의로 허용.
export function resolveIpPolicy(ip: string, allowedEnv: string | undefined, vercelEnv: string | undefined): IpPolicy {
  const entries = (allowedEnv || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) {
    return { allowed: vercelEnv !== 'production', configured: false };
  }
  const allowed = entries.some((entry) => (entry.endsWith('.') ? ip.startsWith(entry) : ip === entry));
  return { allowed, configured: true };
}

// iPadOS Safari "데스크톱 웹사이트 요청" 모드는 Mac UA를 보내지만 터치포인트가 있다. 클라이언트 UI 안내용.
export function isIpadDesktopMode(userAgent: string, maxTouchPoints: number): boolean {
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}
