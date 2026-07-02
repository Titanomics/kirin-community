'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { format, addDays } from 'date-fns';
import { ko } from 'date-fns/locale';
import { Sparkles, Award, ChevronLeft, ChevronRight, X, MessageCircle } from 'lucide-react';
import {
  CORE_VALUES,
  CoreValue,
  getCoreValueIndexForDate,
  getWeekWeekdays,
} from '@/lib/coreValues';

interface Profile {
  id: string;
  display_name: string | null;
  email: string | null;
  team: string | null;
}
interface LogRow {
  id: string;
  user_id: string;
  date: string;
  value_index: number;
  intention: string | null;
  reflection: string | null;
}
interface RecoRow {
  id: string;
  from_user_id: string;
  to_user_id: string;
  date: string;
  value_index: number;
  note: string;
  seen_at: string | null;
}

const categoryColor: Record<CoreValue['category'], string> = {
  전문성: 'bg-blue-500',
  대중성: 'bg-emerald-500',
  역동성: 'bg-amber-500',
};
const categoryBg: Record<CoreValue['category'], string> = {
  전문성: 'bg-blue-50 border-blue-100',
  대중성: 'bg-emerald-50 border-emerald-100',
  역동성: 'bg-amber-50 border-amber-100',
};

export default function CoreValuesPage() {
  const { user, profile } = useAuth();
  const supabase = createClient();
  const isAdmin = profile?.role === 'admin';

  const [weekRef, setWeekRef] = useState(new Date());
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [recos, setRecos] = useState<RecoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [teamFilter, setTeamFilter] = useState<'all' | '커머스팀' | '콘텐츠팀'>('all');
  const [recoModal, setRecoModal] = useState(false);

  const weekdays = useMemo(() => getWeekWeekdays(weekRef), [weekRef]);
  const weekStart = format(weekdays[0], 'yyyy-MM-dd');
  const weekEnd = format(weekdays[4], 'yyyy-MM-dd');

  const profileMap = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p])),
    [profiles]
  );
  const nameOf = useCallback(
    (id: string) => profileMap[id]?.display_name || profileMap[id]?.email || '알 수 없음',
    [profileMap]
  );

  const fetchData = useCallback(async () => {
    const [profRes, logRes, recoRes] = await Promise.all([
      supabase.from('profiles').select('id, display_name, email, team').is('resigned_at', null),
      supabase.from('core_value_log').select('*').gte('date', weekStart).lte('date', weekEnd),
      supabase.from('core_value_recognitions').select('*').gte('date', weekStart).lte('date', weekEnd),
    ]);
    setProfiles(profRes.data || []);
    setLogs(logRes.data || []);
    setRecos(recoRes.data || []);

    // 본인에게 온 안 읽은 인정 → 읽음 처리
    if (user) {
      const unseen = (recoRes.data || []).filter((r) => r.to_user_id === user.id && !r.seen_at);
      if (unseen.length) {
        await supabase
          .from('core_value_recognitions')
          .update({ seen_at: new Date().toISOString() })
          .in('id', unseen.map((r) => r.id));
      }
    }
    setLoading(false);
  }, [weekStart, weekEnd, user]);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  // 팀 필터 적용 (admin만 의미 있음; 일반 사용자는 RLS가 이미 팀 제한)
  const teamMatch = useCallback(
    (uid: string) => teamFilter === 'all' || profileMap[uid]?.team === teamFilter,
    [teamFilter, profileMap]
  );

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });

  // 이번 주 내가 받은 인정 (배너용)
  const myRecos = user ? recos.filter((r) => r.to_user_id === user.id) : [];

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-gray-400">불러오는 중...</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 sm:text-3xl">
            <Sparkles className="h-6 w-6 text-amber-500" /> 이번 주 핵심가치
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            매일 남긴 다짐과 사례가 같은 팀끼리 공유됩니다
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setRecoModal(true)}
            className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600"
          >
            <Award className="h-4 w-4" /> 칭찬하기
          </button>
        )}
      </div>

      {/* 내가 받은 인정 배너 */}
      {myRecos.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-700">
            <Award className="h-4 w-4" /> 이번 주 회장님이 나를 이렇게 인정했어요
          </p>
          <div className="space-y-1.5">
            {myRecos.map((r) => (
              <div key={r.id} className="text-sm text-gray-800">
                <span className={`mr-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold text-white ${categoryColor[CORE_VALUES[r.value_index].category]}`}>
                  {CORE_VALUES[r.value_index].category}
                </span>
                {r.note}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 주간 네비게이션 */}
      <div className="flex items-center justify-between rounded-xl bg-white px-4 py-2 shadow-sm border border-gray-100">
        <button onClick={() => setWeekRef((d) => addDays(d, -7))} className="rounded p-1.5 hover:bg-gray-100">
          <ChevronLeft className="h-4 w-4 text-gray-600" />
        </button>
        <span className="text-sm font-medium text-gray-700">
          {format(weekdays[0], 'M월 d일', { locale: ko })} ~ {format(weekdays[4], 'M월 d일', { locale: ko })}
        </span>
        <button onClick={() => setWeekRef((d) => addDays(d, 7))} className="rounded p-1.5 hover:bg-gray-100">
          <ChevronRight className="h-4 w-4 text-gray-600" />
        </button>
      </div>

      {/* 관리자용 팀 필터 */}
      {isAdmin && (
        <div className="flex gap-2">
          {(['all', '커머스팀', '콘텐츠팀'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTeamFilter(t)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                teamFilter === t ? 'bg-gray-900 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'all' ? '전체' : t}
            </button>
          ))}
        </div>
      )}

      {/* 요일별 카드 */}
      <div className="space-y-4">
        {weekdays.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const idx = getCoreValueIndexForDate(day);
          const val = CORE_VALUES[idx];
          const isToday = dateStr === todayStr;
          const isFuture = dateStr > todayStr;

          const dayLogs = logs
            .filter((l) => l.date === dateStr && teamMatch(l.user_id))
            .filter((l) => l.intention || l.reflection);
          const dayRecos = recos.filter((r) => r.date === dateStr && teamMatch(r.to_user_id));

          return (
            <div
              key={dateStr}
              className={`rounded-2xl border p-5 ${categoryBg[val.category]} ${isToday ? 'ring-2 ring-offset-2 ring-gray-900/70' : ''} ${isFuture ? 'opacity-60' : ''}`}
            >
              {/* 카드 헤더 */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${categoryColor[val.category]}`}>
                    {val.category}
                  </span>
                  <span className="text-sm font-semibold text-gray-800">
                    {format(day, 'M/d (EEE)', { locale: ko })}
                  </span>
                  {isToday && <span className="text-xs font-bold text-gray-900">오늘</span>}
                </div>
              </div>

              {/* DO / DON'T */}
              <div className="mb-4 space-y-1 text-xs text-gray-600">
                <p><b className="text-green-700">DO</b> · {val.do}</p>
                <p><b className="text-red-600">DON&apos;T</b> · {val.dont}</p>
              </div>

              {/* 다짐 / 사례 */}
              {dayLogs.length > 0 ? (
                <div className="space-y-2.5">
                  {dayLogs.map((l) => (
                    <div key={l.id} className="rounded-lg bg-white/70 p-3">
                      <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                        <MessageCircle className="h-3.5 w-3.5 text-gray-400" /> {nameOf(l.user_id)}
                        {isAdmin && profileMap[l.user_id]?.team && (
                          <span className="text-xs font-normal text-gray-400">· {profileMap[l.user_id]?.team}</span>
                        )}
                      </p>
                      {l.intention && (
                        <p className="text-sm text-gray-700"><span className="text-gray-400">다짐 </span>{l.intention}</p>
                      )}
                      {l.reflection && (
                        <p className="mt-0.5 text-sm text-gray-700"><span className="text-gray-400">사례 </span>{l.reflection}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">{isFuture ? '아직 오지 않은 날이에요' : '아직 작성한 사람이 없어요'}</p>
              )}

              {/* 회장님 인정 */}
              {dayRecos.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-white/60 pt-3">
                  {dayRecos.map((r) => (
                    <div key={r.id} className="flex items-start gap-2 text-sm">
                      <Award className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <p className="text-gray-800">
                        <b>{nameOf(r.to_user_id)}</b> — {r.note}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {recoModal && (
        <RecognitionModal
          profiles={profiles.filter((p) => p.id !== user?.id)}
          weekdays={weekdays}
          onClose={() => setRecoModal(false)}
          onSaved={async () => {
            setRecoModal(false);
            await fetchData();
          }}
          supabase={supabase}
          fromUserId={user!.id}
        />
      )}
    </div>
  );
}

function RecognitionModal({
  profiles,
  weekdays,
  onClose,
  onSaved,
  supabase,
  fromUserId,
}: {
  profiles: Profile[];
  weekdays: Date[];
  onClose: () => void;
  onSaved: () => void;
  supabase: ReturnType<typeof createClient>;
  fromUserId: string;
}) {
  const [toUserId, setToUserId] = useState('');
  const [dayIdx, setDayIdx] = useState(() => {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
    const found = weekdays.findIndex((d) => format(d, 'yyyy-MM-dd') === todayStr);
    return found >= 0 ? found : 0;
  });
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = toUserId && note.trim().length >= 2;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    const day = weekdays[dayIdx];
    const dateStr = format(day, 'yyyy-MM-dd');
    const valueIndex = getCoreValueIndexForDate(day);
    const { error } = await supabase.from('core_value_recognitions').insert({
      from_user_id: fromUserId,
      to_user_id: toUserId,
      date: dateStr,
      value_index: valueIndex,
      note: note.trim(),
    });
    setSaving(false);
    if (error) {
      alert('저장 실패: ' + error.message);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900">
            <Award className="h-5 w-5 text-amber-500" /> 칭찬하기
          </h3>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">누구를</label>
            <select
              value={toUserId}
              onChange={(e) => setToUserId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            >
              <option value="">직원 선택</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.display_name || p.email) + (p.team ? ` (${p.team})` : '')}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">어떤 날 / 어떤 가치</label>
            <select
              value={dayIdx}
              onChange={(e) => setDayIdx(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            >
              {weekdays.map((d, i) => {
                const v = CORE_VALUES[getCoreValueIndexForDate(d)];
                return (
                  <option key={i} value={i}>
                    {format(d, 'M/d (EEE)', { locale: ko })} · {v.category}
                  </option>
                );
              })}
            </select>
            <p className="mt-1 text-xs text-gray-400">
              {CORE_VALUES[getCoreValueIndexForDate(weekdays[dayIdx])].do}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">무엇을 했는지 (구체적으로)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="예) CTR 데이터 보고 기획을 과감히 뒤집음"
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="flex-1 rounded-lg bg-amber-500 py-2.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-40"
          >
            {saving ? '저장 중...' : '인정 남기기'}
          </button>
        </div>
      </div>
    </div>
  );
}
