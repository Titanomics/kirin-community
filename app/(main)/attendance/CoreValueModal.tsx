'use client';

import { useState } from 'react';
import { CoreValue } from '@/lib/coreValues';
import { CheckCircle2, XCircle, Sparkles } from 'lucide-react';

const categoryColor: Record<CoreValue['category'], string> = {
  전문성: 'from-blue-500 to-blue-600',
  대중성: 'from-emerald-500 to-emerald-600',
  역동성: 'from-amber-500 to-amber-600',
};

// 공백·특수문자는 무시하고 글자만 비교 (따라쓰기 관대하게)
const norm = (s: string) => s.replace(/[\s—·\-,.·"'’“”!?]/g, '');

export default function CoreValueModal({
  value,
  mode,
  onConfirm,
  onClose,
}: {
  value: CoreValue;
  mode: 'checkin' | 'checkout';
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [doInput, setDoInput] = useState('');
  const [dontInput, setDontInput] = useState('');
  const [checked, setChecked] = useState(false);

  const doMatch = doInput.length > 0 && norm(doInput) === norm(value.do);
  const dontMatch = dontInput.length > 0 && norm(dontInput) === norm(value.dont);
  const canConfirm = mode === 'checkin' ? doMatch && dontMatch : checked;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2 text-sm font-bold tracking-widest text-gray-400">
          <Sparkles className="h-4 w-4" /> 오늘의 핵심가치
        </div>
        <div className={`mb-4 inline-block rounded-full bg-gradient-to-r ${categoryColor[value.category]} px-4 py-1 text-sm font-bold text-white`}>
          {value.category}
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

        {mode === 'checkin' ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500">
              아래 두 문장을 그대로 따라 입력하면 출근됩니다 (띄어쓰기·기호는 달라도 됩니다)
            </p>
            <input
              value={doInput}
              onChange={(e) => setDoInput(e.target.value)}
              placeholder="위 DO 문장을 따라 쓰세요"
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${doMatch ? 'border-green-400 bg-green-50' : 'border-gray-300 focus:border-blue-400'}`}
            />
            <input
              value={dontInput}
              onChange={(e) => setDontInput(e.target.value)}
              placeholder="위 DON'T 문장을 따라 쓰세요"
              className={`w-full rounded-lg border px-3 py-2 text-sm outline-none ${dontMatch ? 'border-green-400 bg-green-50' : 'border-gray-300 focus:border-blue-400'}`}
            />
          </div>
        ) : (
          <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-lg bg-gray-50 p-4 text-sm font-medium text-gray-800">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="h-5 w-5"
            />
            오늘 이 DO를 지키고 DON&apos;T를 피했습니다
          </label>
        )}

        <button
          onClick={onConfirm}
          disabled={!canConfirm}
          className="mt-5 w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mode === 'checkin' ? '출근하기' : '퇴근하기'}
        </button>
      </div>
    </div>
  );
}
