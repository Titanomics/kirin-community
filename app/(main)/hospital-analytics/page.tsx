import { redirect } from 'next/navigation';
import { AnalyticsError, readAccess, publicAccess } from '@/lib/hospital-analytics/access';
import HospitalAnalytics from './workspace';

export const dynamic = 'force-dynamic';
export default async function HospitalAnalyticsPage() {
  let access;
  try { access = await readAccess(); }
  catch (error) {
    if (error instanceof AnalyticsError && error.status === 401) redirect('/login?next=%2Fhospital-analytics');
    return <div className="p-8"><h1 className="text-2xl font-bold">병원 분석</h1><p role="alert" className="mt-4">{error instanceof AnalyticsError ? error.message : '접근 권한을 확인하지 못했습니다.'}</p></div>;
  }
  if (!access.canAccessTab) return <div className="p-8"><h1 className="text-2xl font-bold">병원 분석 접근 권한이 없습니다.</h1><p className="mt-3">관리자가 병원 분석 탭 접근을 허용하면 사용할 수 있습니다.</p></div>;
  return <HospitalAnalytics initial={publicAccess(access)} />;
}
