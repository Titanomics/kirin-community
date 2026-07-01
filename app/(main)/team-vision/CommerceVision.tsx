import { Target, Rocket, Sparkles, Users } from 'lucide-react';

const values = [
  { name: '전문성', slogan: '결과의 완결성으로 증명한다', do: '기획 먼저 · 내 결과물은 내 얼굴 · 시간은 신뢰', dont: '같은 실수 반복 · 과정 호소 · 문제 은폐' },
  { name: '대중성', slogan: '철저히 고객의 시선으로, 고객의 언어로', do: '고객 집착 · 눈높이 번역 · 선제적 제안', dont: '공급자 마인드 · 고객 무시 · 시장성 무시' },
  { name: '역동성', slogan: '고인 물은 썩는다. 끊임없이 움직인다', do: 'R&R 초월 · Solution 지향 · Agile · Trend', dont: '수동적 태도 · 핑계 · 굼뜬 태도' },
];

const rocks = [
  '솔잎 출시 + 9월 매출 5천만',
  '미백치약 — 디데이치과 공동 개발',
  '하임리히키트 자사몰 8/31 정식 런칭',
  '외주 1명 안착 + 자동 검수 v1',
  '12주 연속 매주 회의 운영 100%',
  '솔잎·치약·하임 키워드 룰북 3개',
  '브랜드 만들기 3단계 매뉴얼 v1',
];

const org = [
  { role: '마케팅·영업 (CMO)', desc: '바이럴 · 콘텐츠 · 퍼포먼스 · 디자인' },
  { role: '운영 (COO)', desc: '자사몰 운영 · 상품기획 · 제조 · CS/CRM' },
  { role: '재무·인프라 (CFO)', desc: '손익 · 세무 · 자금 · 인사' },
];

export default function CommerceVision() {
  return (
    <div className="space-y-6">
      {/* 미션 */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-700 p-8 text-white shadow">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold tracking-widest text-emerald-100">
          <Target className="h-4 w-4" /> MISSION
        </div>
        <p className="text-2xl font-black leading-snug">가장 폐쇄적인 지식을,<br />가장 대중적인 라이프스타일로</p>
        <p className="mt-3 text-sm text-emerald-100">예방의학을 좋아하는 사람들에게 의료 커머스 브랜드를 만든다</p>
      </div>

      {/* 5년 비전 */}
      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="mb-4 flex items-center gap-2 text-xs font-bold tracking-widest text-gray-400">
          <Rocket className="h-4 w-4" /> 5년 후
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-emerald-50 p-4 text-center">
            <p className="text-3xl font-black text-emerald-700">100억</p>
            <p className="text-xs text-gray-500">영업이익</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-4 text-center">
            <p className="text-3xl font-black text-emerald-700">10개</p>
            <p className="text-xs text-gray-500">브랜드</p>
          </div>
        </div>
      </div>

      {/* 핵심가치 */}
      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="mb-4 flex items-center gap-2 text-xs font-bold tracking-widest text-gray-400">
          <Sparkles className="h-4 w-4" /> 핵심가치
        </div>
        <div className="space-y-3">
          {values.map((v) => (
            <div key={v.name} className="rounded-xl border border-gray-100 p-4">
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold text-gray-900">{v.name}</span>
                <span className="text-xs text-gray-500">{v.slogan}</span>
              </div>
              <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                <p className="rounded bg-green-50 px-2 py-1 text-green-800">✅ {v.do}</p>
                <p className="rounded bg-red-50 px-2 py-1 text-red-800">❌ {v.dont}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Q3 분기 짱돌 */}
      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="mb-4 flex items-center gap-2 text-xs font-bold tracking-widest text-gray-400">
          🪨 이번 분기 목표 (Q3)
        </div>
        <ul className="space-y-2">
          {rocks.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">{i + 1}</span>
              {r}
            </li>
          ))}
        </ul>
      </div>

      {/* 책임조직도 */}
      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="mb-4 flex items-center gap-2 text-xs font-bold tracking-widest text-gray-400">
          <Users className="h-4 w-4" /> 책임조직도
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {org.map((o) => (
            <div key={o.role} className="rounded-xl bg-gray-50 p-4">
              <p className="text-sm font-bold text-gray-900">{o.role}</p>
              <p className="mt-1 text-xs text-gray-600">{o.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
