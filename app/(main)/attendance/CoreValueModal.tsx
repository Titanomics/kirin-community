'use client';

import { CoreValue } from '@/lib/coreValues';
import { CheckCircle2, XCircle, Sparkles } from 'lucide-react';

const categoryColor: Record<CoreValue['category'], string> = {
  전문성: 'from-blue-500 to-blue-600',
  대중성: 'from-emerald-500 to-emerald-600',
  역동성: 'from-amber-500 to-amber-600',
};

export default function CoreValueModal({ value, onClose }: { value: CoreValue; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-2 text-sm font-bold tracking-widest text-gray-400">
          <Sparkles className="h-4 w-4" /> 오늘의 핵심가치
        </div>
        <div className={`mb-5 inline-block rounded-full bg-gradient-to-r ${categoryColor[value.category]} px-4 py-1 text-sm font-bold text-white`}>
          {value.category}
        </div>
        <div className="space-y-3">
          <div className="rounded-xl bg-green-50 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-bold text-green-700">
              <CheckCircle2 className="h-4 w-4" /> DO
            </div>
            <p className="text-sm text-gray-800">{value.do}</p>
          </div>
          <div className="rounded-xl bg-red-50 p-4">
            <div className="mb-1 flex items-center gap-2 text-sm font-bold text-red-700">
              <XCircle className="h-4 w-4" /> DON&apos;T
            </div>
            <p className="text-sm text-gray-800">{value.dont}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700"
        >
          확인
        </button>
      </div>
    </div>
  );
}
