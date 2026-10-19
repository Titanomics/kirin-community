# ERP hospital analytics deployment

The module is implemented on `feature/hospital-analytics-access`. It reuses the existing Excel aggregation and interactive report engine. Actual patient workspaces and clinical Excel files are excluded from this repository. Existing local data has not been uploaded to production by this change.

## User flow

1. Sign in with the existing ERP account and open **병원 분석**.
2. An active `profiles.role = admin` account can register clinics and assign existing employees as editor or viewer. Admins see all clinics. Other employees see only explicitly assigned clinics; belonging to 콘텐츠팀 or being an existing `hospitals.assignee_id` does not grant clinical analytics access.
3. Select a clinic. Upload the annual **접수수납목록** first, then **내원환자내원경로분포** including its patient-detail sheets for address matching. The remaining supported annual summaries are monthly visits, reservations, age distribution, consultations, fees, and treatments. Unmatched addresses are reported as unmatched, never invented.
4. Preview and confirm each replacement. Regions use unique-patient counts: zero is transparent, higher counts use darker purple. Clicking exposes the selected region's aggregate amounts.
5. In **월간 고객 보고서**, generate a draft for the desired month, save interpretation, and download the interactive HTML or open its presentation and print to PDF. Reports keep their captured period/data. Latest EMR is not required to view historic periods; source cutoff dates remain visible.

## Architecture and deployment gates

- Next.js pages and routes use the existing Supabase SSR login; profiles and grants are checked on every request. The Python function independently verifies the user JWT and clinic access. No service-role key is used by the app.
- `ha_clinics`, `ha_memberships`, `ha_snapshots`, and `ha_audit` use RLS. `ha_commit_snapshot` is a transactional compare-and-swap: a stale writer gets a conflict.
- The private `hospital-analytics` bucket stores immutable uploads and snapshots under clinic UUIDs. Restrictive policies also fence off preexisting broad Storage policies. Storage operations are allowlisted so employees cannot mint signed read/upload URLs that survive revocation. Direct JWT uploads are rechecked by RLS at the actual upload.
- Each Python request creates a separate temporary workspace; only successful mutations publish a new persistent snapshot. Snapshot restoration verifies names, hashes, sizes and timestamps; pending Excel previews survive cold starts. Missing/corrupt storage fails closed rather than silently creating an empty clinic.
- Python and Next send a source fingerprint. A mismatch rejects the request before dispatch and prevents mixing different deployments. `prebuild` verifies the 83-file engine inventory and generates the Next fingerprint. `.gitattributes` preserves the vendored bytes.

## Before applying the migration

1. Confirm project `kirin-community`, owner `titanomics-projects` / `team_f20EuAsQJUx3tJj4NBm3DWB9`, and Git source `Titanomics/kirin-community`. The connected Vercel tool returned 403 for this team on 2026-10-19; another available Vercel project must not be substituted.
2. Use the ERP's actual Supabase project with a database-owner session. Do not paste service keys into code or commit `.env` files.
3. Run `supabase/preflight-hospital-analytics.sql`. Confirm existing `profiles` cannot let ordinary employees change their own `role` or clear `resigned_at`. Those existing policy definitions are not included in this Git repository and must be verified on the actual project.
4. Confirm the official `storage.allow_only_operation(text)` and `storage.allow_any_operation(text[])` helpers exist. If absent, update the Storage deployment through its supported mechanism before applying this migration. Do not remove the operation fences to bypass the check.
5. Apply `supabase/migrations/202610190001_hospital_analytics.sql` once. It is transactional and does not modify existing ERP tables/data. Verify the bucket is private and the new RLS policies are present.

## Vercel configuration

Keep the ERP's existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the correct environment. The Python function needs these same existing public-client settings; no new paid model API key is needed.

`vercel.json` bundles `analytics_runtime/**` with `api/analytics_runtime.py` and permits a 300-second function duration. Next routes and Python functions coexist in this project. `npm run build` runs inventory/fingerprint generation before the existing Next build. A Next build alone does not verify Vercel's Python packaging; inspect the actual Vercel build logs and exercise the deployed Python route before release.

For an existing configured `VERCEL_AUTOMATION_BYPASS_SECRET`, the gateway uses the exact `VERCEL_URL` deployment and forwards that bypass header. Without it, a promoted production deployment uses `VERCEL_PROJECT_PRODUCTION_URL` (fallback: the requested `kirin-community.vercel.app` domain) because generated production URLs can be protected. Preview calls forward the user's Vercel protection cookie. A staged `--prod --skip-domain` deployment without bypass must not be treated as validated: it would reach the old production alias, and the version guard intentionally rejects it.

Verify the deployed flow with synthetic clinics first: anonymous denial, admin assignment, editor Excel preview/commit, viewer denial of writes, different-clinic denial, access revocation, cold-start persistence, and HTML/PDF output. Then create real clinic spaces and upload their files through the authenticated UI. Do not put files under Next `public/` or a public Storage bucket.

## Current operating bounds

- XLSX upload: 25 MiB; archived clinic snapshot: 50 MiB compressed / 250 MiB expanded; at most 3,000 files. The function uses a fresh temporary directory per request and never persists solely in `/tmp`.
- Snapshot writes currently retain immutable previous objects. This supports investigation and protects against lost updates, but storage usage grows. Measure storage/latency with representative clinic histories and agree retention before broad agency rollout. No unreviewed automatic deletion is included.
- Existing raw files, patient identifiers and addresses are not sent to a model. Subscription-CLI AI generation, PC-local backup restoration, and unattended local monitoring are not connected to the Vercel runtime; those routes report unavailable. Excel analysis, manual marketing records, regional data and report generation work independently.
- Report PDFs are produced through the browser's print-to-PDF flow, not a server PDF service.
- The new clinic registry is separate from the ERP's existing task-oriented hospital list, whose DB schema was unavailable in Git. Existing hospital/task permissions are unchanged.

## Reproduce local checks without production credentials

```powershell
python -m unittest discover -s tests/analytics -p 'test_*.py' -v
node --test tests/analytics/scope.test.mjs
python tests/analytics/test_sql_security.py --postgres-bin 'C:/Users/gkfk0/Desktop/claudecode/CODEX/doctor domain/.superpowers/tools/postgres/runtime/pgsql/bin'
npx tsc --noEmit
npx eslint 'app/(main)/hospital-analytics' app/api/hospital-analytics lib/hospital-analytics
```

For the browser harness, run `python tests/analytics/browser_fixture.py` (ports 54840/54842). In a separate shell set the **synthetic** values `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54842`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-public-key`, `HA_RUNTIME_URL=http://127.0.0.1:54840/api/analytics_runtime`; run `npm run dev -- --hostname 127.0.0.1 --port 54843`, then `python tests/analytics/browser_flow.py`. The production gateway refuses this loopback override. Stop these exact test processes afterwards; Windows shells can leave Python child processes alive.

Sources: [Vercel Next + Python](https://vercel.com/kb/guide/how-to-use-python-and-javascript-in-the-same-application), [Supabase Storage operation helpers](https://supabase.com/docs/guides/storage/schema/helper-functions), [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals).
