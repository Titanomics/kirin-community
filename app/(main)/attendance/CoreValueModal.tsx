'use client';

import { useState } from 'react';
import { CoreValue } from '@/lib/coreValues';
import { CheckCircle2, XCircle, Sparkles, Info } from 'lucide-react';

const categoryColor: Record<CoreValue['category'], string> = {
  전문성: 'from-blue-500 to-blue-600',
  대중성: 'from-emerald-500 to-emerald-600',
  역동성: 'from-amber-500 to-amber-600',
};

// 대충 입력 방지: 글자·숫자만 남겼을 때 의미 있는 최소 분량인지 검사
// (".", "ㅜㅜ", "ㅋㅋㅋ", "가가가" 같은 건 걸러내고, 진짜 문장만 기록으로 저장)
function isMeaningful(s: string): boolean {
  const stripped = s.replace(/[^\p{L}\p{N}]/gu, '');
  if (stripped.length < 5) return false; // 최소 5자
  if (/^(.)\1*$/u.test(stripped)) return false; // 같은 글자 반복만 (ㅋㅋㅋ, 아아아)
  // 완성형 한글/영문/숫자가 하나도 없으면(자음·모음 낱자만) 거부
  if (!/[가-힣A-Za-z0-9]/.test(stripped)) return false;
  return true;
}

export default function CoreValueModal({
  value,
  mode,
  isGrace,
  onConfirm,
  onClose,
}: {
  value: CoreValue;
  mode: 'checkin' | 'checkout';
  isGrace: boolean;
  onConfirm: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const trimmed = text.trim();
  const meaningful = isMeaningful(trimmed);
  // 계도기간이든 아니든 출퇴근은 절대 막지 않는다(방식 A). 버튼 항상 활성.
  // 입력이 있으나 너무 부실하면 저장은 안 하고 안내만.
  const tooShort = trimmed.length > 0 && !meaningful;

  const isCheckin = mode === 'checkin';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2 text-sm font-bold tracking-widest text-gray-400">
          <Sparkles className="h-4 w-4" /> 오늘의 핵심가치
        </div>
        <div className={`mb-3 inline-block rounded-full bg-gradient-to-r ${categoryColor[value.category]} px-4 py-1 text-sm font-bold text-white`}>
          {value.category}
        </div>

        {/* 왜 쓰는지 안내 */}
        <div className="mb-4 flex gap-2 rounded-xl bg-blue-50 p-3 text-xs leading-relaxed text-blue-800">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            매일 우리 핵심가치를 <b>내 일에 붙여보는 연습</b>이에요. 잘 쓰는 게 목적이 아니라,
            하루 한 번 떠올리는 게 목적입니다. 남긴 내용은 <b>같은 팀에게 공유</b>돼요.
          </span>
        </div>

        <div className="space-y-2">
          <div className="rounded-xl bg-green-50 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-bold text-green-700">
              <CheckCircle2 className="h-4 w-4" /> DO
            </div>
            <p className="text-sm text-gray-800">{value.do}</p>
          </div>
          <div className="rounded-xl bg-red-50 p-3">
            <div className="mb-1 flex items-center gap-2 text-sm font-bold text-red-700">
              <XCircle className="h-4 w-4" /> DON&apos;T
            </div>
            <p className="text-sm text-gray-800">{value.dont}</p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-sm font-semibold text-gray-700">
            {isCheckin
              ? '오늘 이 가치를 내 일 어디에 써볼까요?'
              : '오늘 이 가치로 내가 실제로 한 것은?'}
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder={
              isCheckin
                ? '예) 리뷰 20개 읽고 CS 반복 질문 3개 정리해보기'
                : '예) 리뷰에서 반품 사유 3개 패턴을 찾아 소개문에 반영함'
            }
            className={`w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors
              ${meaningful ? 'border-green-400 bg-green-50' : tooShort ? 'border-amber-300 bg-amber-50' : 'border-gray-300 focus:border-blue-400'}`}
          />
          {tooShort && (
            <p className="text-xs text-amber-600">
              한 줄로 조금만 더 적어주세요. (이대로는 기록에 남지 않아요 — 그래도 {isCheckin ? '출근' : '퇴근'}은 됩니다)
            </p>
          )}
        </div>

        {/* 계도기간 안내 */}
        {isGrace && (
          <div className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
            🌱 지금은 <b>계도기간(첫 2주)</b>이에요. 버튼을 누르면 <b>바로 {isCheckin ? '출근' : '퇴근'} 처리</b>되고,
            핵심가치는 편하게 연습 삼아 써보시면 됩니다. 안 써도 괜찮아요.
          </div>
        )}

        <button
          onClick={() => onConfirm(meaningful ? trimmed : '')}
          className="mt-5 w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {isCheckin ? '출근하기' : '퇴근하기'}
        </button>
      </div>
    </div>
  );
}
