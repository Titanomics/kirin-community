import { Target, Rocket, Sparkles, Users } from 'lucide-react';

const values = [
  { name: '전문성', slogan: '결과의 완결성으로 증명한다', do: '의료 콘텐츠 정확성 · 의료법 준수 · 시스템 표준', dont: '같은 실수 반복 · 과정 호소 · 문제 은폐' },
  { name: '대중성', slogan: '회의실 논리가 아닌 카페 독자의 언어', do: '환자가 이해하는 언어 · 원장이 1분에 보는 자료', dont: '공급자 마인드 · 고객 무시 · 시장성 무시' },
  { name: '역동성', slogan: '결과물이 곧 본인의 얼굴', do: '테스트 → 측정 → 반영 · 빠른 사이클', dont: '수동적 태도 · 핑계 · 굼뜬 태도' },
];

const rocks = [
  '위탁 병원 운영 매뉴얼 v1 완성',
  '위탁 병원 표준 브랜딩 패키지 v1',
  '콘텐츠 스터디 시스템 만들기',
  'AI 사진 정리 시스템 (코워크)',
  '삼성아이웰 네트워크 총괄 계약',
  '에이블병원 광고 ROAS 목표',
];

const org = [
  { role: 'CEO (비전가)', desc: '대외 얼굴 · 최종 의사결정' },
  { role: '통합 조정자', desc: '3축 조정 · 인사·세무·자금 통합' },
  { role: 'CMO — 영업·마케팅', desc: '신규 영업 · 광고 운영 · 병원 브랜딩' },
  { role: 'COO — 운영', desc: '위탁 병원 운영 · 시스템 · 검진센터' },
  { role: 'CCO — 콘텐츠', desc: '블로그·SEO · 영상·SNS · 디지털 자산' },
];

export default function ContentVision() {
  return (
    <div className="space-y-6">
      {/* 미션 */}
      <div className="rounded-2xl bg-gradient-to-br from-amber-600 to-amber-700 p-8 text-white shadow">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold tracking-widest text-amber-100">
          <Target className="h-4 w-4" /> MISSION
        </div>
        <p className="text-2xl font-black leading-snug">진료만 하고 싶은 병원 원장에게,<br />진료 외 모든 영역을 운영해준다</p>
        <p className="mt-3 text-sm text-amber-100">마케팅 + 운영 + HR + 원장 브랜딩을 한 회사가 통합 위탁 (한국형 MSO)</p>
      </div>

      {/* 5년 비전 */}
      <div className="rounded-2xl bg-white p-6 shadow">
        <div className="mb-4 flex items-center gap-2 text-xs font-bold tracking-widest text-gray-400">
          <Rocket className="h-4 w-4" /> 5년 후
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-amber-50 p-4 text-center">
            <p className="text-2xl font-black text-amber-700">50억</p>
            <p className="text-xs text-gray-500">연 매출</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-4 text-center">
            <p className="text-2xl font-black text-amber-700">15억</p>
            <p className="text-xs text-gray-500">영업이익</p>
          </div>
          <div className="rounded-xl bg-amber-50 p-4 text-center">
            <p className="text-2xl font-black text-amber-700">1호점</p>
            <p className="text-xs text-gray-500">검진센터 300평</p>
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
              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">{i + 1}</span>
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
        <div className="grid gap-3 sm:grid-cols-2">
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
