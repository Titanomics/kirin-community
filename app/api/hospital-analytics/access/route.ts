import { readAccess, publicAccess } from '@/lib/hospital-analytics/access';
import { json, failure } from '@/lib/hospital-analytics/http';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { return json(publicAccess(await readAccess())); } catch (error) { return failure(error); }
}
