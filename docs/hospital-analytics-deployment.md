# ERP hospital analytics deployment

## Tab-access correction — 2026-10-19 23:03 KST

- The permission target is the whole Hospital Analysis tab. Among ordinary employees the allowlist contains 전형진 only; active admins retain management access. There is no separate clinic assignment or viewer role in the current model.
- New migration `20261019140344_hospital_analytics_tab_access.sql` was applied once to `aniymyjlxctiqhhhfsjh`; the earlier three migrations were not rerun. A normal logged-in ERP admin granted the tab through the RLS-protected REST API; no service-role key or impersonated session was used.
- Local checks passed: 17 real PostgreSQL tab/security checks, 14 Python tests, 1 Node test, 10 browser flow groups, TypeScript, targeted lint, and the Next production build. Independent Codex review found no P1/P2 blocker and independently checked the Next/Python fingerprint and diff whitespace.
- Advisor warnings added only the intentional SECURITY DEFINER tab-access helper for anonymous/authenticated roles. It returns false without an active authorized identity; anonymous table access and trigger execution stay revoked. Existing ERP warnings remain outside this change.
- Real 전형진 login/use remains unverified because the user cannot log in with that account now. Database-role simulations and synthetic local users are separate evidence, not real login tests.
- Rolling back only the application deployment does not restore the former clinic permission model: the database now authorizes by tab. Preserve the new allowlist and diagnose forward; do not replay or reverse migrations blindly.

The module is implemented on `feature/hospital-analytics-access`. It reuses the existing Excel aggregation and interactive report engine. Actual patient workspaces and clinical Excel files are excluded from this repository. Existing local data has not been uploaded to production by this change.

## User flow

1. Sign in with the existing ERP account and open **병원 분석**.
2. An active `profiles.role = admin` account opens **병원 분석 관리** to register clinics and choose who can access the **병원 분석 tab**. The employee permission form has no clinic selector. Selected active employees can view/edit every current and future analytics clinic; admins always retain access. Other staff cannot see the sidebar tab or directly access its page, API, or files. Legacy clinic memberships, team membership and `hospitals.assignee_id` do not grant access. The current requested allowlist is 전형진 only among ordinary employees.
3. Select a clinic. Upload the annual **접수수납목록** first, then **내원환자내원경로분포** including its patient-detail sheets for address matching. The remaining supported annual summaries are monthly visits, reservations, age distribution, consultations, fees, and treatments. Unmatched addresses are reported as unmatched, never invented.
4. Preview and confirm each replacement. Regions use unique-patient counts: zero is transparent, higher counts use darker purple. Clicking exposes the selected region's aggregate amounts.
5. In **월간 고객 보고서**, generate a draft for the desired month, save interpretation, and download the interactive HTML or open its presentation and print to PDF. Reports keep their captured period/data. Latest EMR is not required to view historic periods; source cutoff dates remain visible.

## Architecture and deployment gates

- Next.js pages and routes use the existing Supabase SSR login; profiles and grants are checked on every request. The Python function independently verifies the user JWT and clinic access. No service-role key is used by the app.
- `ha_tab_memberships` is the administrator-managed tab allowlist; `ha_tab_access_audit` records grants/revocations. Both use RLS, as do the existing clinic/snapshot/audit tables. Historical `ha_memberships` rows remain as evidence and no longer authorize access. `ha_commit_snapshot` is a transactional compare-and-swap: a stale writer gets a conflict.
- The private `hospital-analytics` bucket stores immutable uploads and snapshots under clinic UUIDs. Restrictive policies also fence off preexisting broad Storage policies. Storage operations are allowlisted so employees cannot mint signed read/upload URLs that survive revocation. Direct JWT uploads are rechecked by RLS at the actual upload.
- Each Python request creates a separate temporary workspace; only successful mutations publish a new persistent snapshot. Snapshot restoration verifies names, hashes, sizes and timestamps; pending Excel previews survive cold starts. Missing/corrupt storage fails closed rather than silently creating an empty clinic.
- Python and Next send a source fingerprint. A mismatch rejects the request before dispatch and prevents mixing different deployments. `prebuild` verifies the 83-file engine inventory and generates the Next fingerprint. `.gitattributes` preserves the vendored bytes.

## Historical initial setup — already applied

This section records the original PR #1 setup. Its three migrations are already applied. The old `verify-hospital-analytics.sql` smoke test expects per-clinic roles and must not run against the current tab-access model. Use `test_tab_access_sql.py` locally and the live tab-access assertions described above.

1. Confirm project `kirin-community`, owner `titanomics-projects` / `team_f20EuAsQJUx3tJj4NBm3DWB9`, and Git source `Titanomics/kirin-community`. The connected Vercel tool returned 403 for this team on 2026-10-19; another available Vercel project must not be substituted.
2. Use the ERP's actual Supabase project with a database-owner session. Do not paste service keys into code or commit `.env` files.
3. Run `supabase/preflight-hospital-analytics.sql`. The live 2026-10-19 inspection found that the existing profile trigger did not protect `resigned_at`, and accepted retired admins. The additive `20261019090326_guard_hospital_analytics_profile_authorization.sql` closes those paths without replacing existing ERP field checks. Apply it before enabling analytics.
4. Confirm the official `storage.allow_only_operation(text)` and `storage.allow_any_operation(text[])` helpers exist. If absent, update the Storage deployment through its supported mechanism before applying this migration. Do not remove the operation fences to bypass the check.
5. The original setup applied `supabase/migrations/20261019090646_hospital_analytics.sql` once, then `20261019091009_harden_hospital_analytics_function_grants.sql`. The core migration added only HA tables/functions/policies and the private bucket. The grant follow-up accounted for Supabase's explicit default grants to `anon`/`authenticated`; revoking only `PUBLIC` is insufficient. RLS, bucket privacy, and function ACLs were verified; the historical rollback-only smoke test was `supabase/verify-hospital-analytics.sql`.

These three migrations were applied to `aniymyjlxctiqhhhfsjh` on 2026-10-19; do not replay them. Filenames match the versions assigned by Supabase. This repository does not contain the ERP's full earlier migration history; do not run a blind `db push`/reset against production.

## Vercel configuration

Keep the ERP's existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the correct environment. The Python function needs these same existing public-client settings; no new paid model API key is needed.

`vercel.json` bundles `analytics_runtime/**` with `api/analytics_runtime.py` and permits a 300-second function duration. Next routes and Python functions coexist in this project. `npm run build` runs inventory/fingerprint generation before the existing Next build. A Next build alone does not verify Vercel's Python packaging; inspect the actual Vercel build logs and exercise the deployed Python route before release.

For an existing configured `VERCEL_AUTOMATION_BYPASS_SECRET`, the gateway uses the exact `VERCEL_URL` deployment and forwards that bypass header. Without it, a promoted production deployment uses `VERCEL_PROJECT_PRODUCTION_URL` (fallback: the requested `kirin-community.vercel.app` domain) because generated production URLs can be protected. Preview calls forward the user's Vercel protection cookie. A staged `--prod --skip-domain` deployment without bypass must not be treated as validated: it would reach the old production alias, and the version guard intentionally rejects it.

Verify the deployed flow with synthetic clinics first: anonymous denial, admin tab grant/revocation, selected employee access across clinics, unselected employee denial despite historical clinic grants, zero-clinic tab visibility, Excel preview/commit, cold-start persistence, and HTML/PDF output. Then create real clinic spaces and upload their files through the authenticated UI. Do not put files under Next `public/` or a public Storage bucket.

## Current operating bounds

- Internal finance (agency income/cost/time records) is disabled in this cloud release. The common clinic archive is readable and replaceable by staff with tab access, so it cannot provide a separate admin-only boundary. Finance routes are rejected before reading the snapshot; finance SQLite files, markers and sidecars are rejected during packing and restoration. No live finance data existed when this bound was applied. Re-enable only after adding a separate protected store.
- Public clinic coordinates are shared clinic content. Staff with tab access and active admins can save/clear them. The cloud API and UI use the same rule. Clinic registration and tab access management remain active-admin-only.
- XLSX upload: 25 MiB; archived clinic snapshot: 50 MiB compressed / 250 MiB expanded; at most 3,000 files. The function uses a fresh temporary directory per request and never persists solely in `/tmp`.
- Snapshot writes currently retain immutable previous objects. This supports investigation and protects against lost updates, but storage usage grows. Measure storage/latency with representative clinic histories and agree retention before broad agency rollout. No unreviewed automatic deletion is included.
- Existing raw files, patient identifiers and addresses are not sent to a model. Subscription-CLI AI generation, PC-local backup restoration, and unattended local monitoring are not connected to the Vercel runtime; those routes report unavailable. Excel analysis, manual marketing records, regional data and report generation work independently.
- Report PDFs are produced through the browser's print-to-PDF flow, not a server PDF service.
- The new clinic registry is separate from the ERP's existing task-oriented hospital list, whose DB schema was unavailable in Git. Existing hospital/task permissions are unchanged.

## Reproduce local checks without production credentials

```powershell
python -m unittest discover -s tests/analytics -p 'test_*.py' -v
node --test tests/analytics/scope.test.mjs
python tests/analytics/test_tab_access_sql.py --postgres-bin 'C:/Users/gkfk0/Desktop/claudecode/CODEX/doctor domain/.superpowers/tools/postgres/runtime/pgsql/bin'
npx tsc --noEmit
npx eslint 'app/(main)/hospital-analytics' app/api/hospital-analytics lib/hospital-analytics
```

For the browser harness, run `python tests/analytics/browser_fixture.py` (ports 54840/54842). In a separate shell set the **synthetic** values `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54842`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=synthetic-public-key`, `HA_RUNTIME_URL=http://127.0.0.1:54840/api/analytics_runtime`; run `npm run dev -- --hostname 127.0.0.1 --port 54843`, then `python tests/analytics/browser_flow.py`. The production gateway refuses this loopback override. Stop these exact test processes afterwards; Windows shells can leave Python child processes alive.

`npm run build` also needs the two public Supabase settings. Synthetic values are sufficient for a credential-free build check; that check does not validate Vercel's environment settings. Do not run `next dev` and `next build` concurrently in the same checkout because both write `.next`.

## Operational verification — 2026-10-19

The sections below record historical verification of PR #1's clinic-level model. The current tab-level model above supersedes those permission expectations. Do not run the historical `verify-hospital-analytics.sql` clinic-role assertions against the new model or replay the three completed migrations. The new additive `hospital_analytics_tab_access` migration alone replaces the permission helper and adds the tab allowlist/audit.

- 18:03:26 KST: applied the profile authorization guard. At 18:05:24, an actual authenticated-role attempt to change the caller's own `resigned_at` was rejected in a rolled-back transaction.
- 18:06:46 KST: applied HA schema. At 18:07:25, all four tables had RLS, all 15 HA policies existed, and `hospital-analytics` was private with a 50 MiB limit.
- 18:10:09 KST: applied explicit function-grant hardening. At 18:11:08, anonymous commit and all API-role trigger execution privileges were false; authenticated commit remained true.
- 18:10:47 KST: live rollback-only test passed admin clinic/member setup, snapshot initialization, editor clinic isolation, viewer write denial, immediate revocation and anonymous denial. After rollback, clinics/memberships/snapshots/audit remained empty; no patient files were uploaded.
- Local verification: 39 actual PostgreSQL privilege/concurrency tests, 14 Python tests and 1 Node test passed. Next production build passed with synthetic public settings. The initial build without public settings failed on `/admin`; supplying the required settings resolved it. The existing middleware deprecation warning remains.
- Browser verification: 8 groups passed through actual Next → Python with a synthetic loopback Supabase service: two Excel formats, cold-request persistence/map, HTML/PDF, admin assignment/revocation, viewer isolation, editor location form/persistence, pending-upload revocation, and anonymous denial. The location form test initially typed before its asynchronous load completed; waiting for `inert=false` made the test exercise the same readiness boundary as a real user. These checks do not replace Vercel-hosted verification.
- Independent Codex review verified finance exclusion, public-location permission boundaries, source fingerprint equality and live guard metadata. No remaining P1/P2 in those changes. The intentional RLS helper SECURITY DEFINER functions and authenticated snapshot RPC still trigger advisor warnings; their UID/access checks are covered by SQL tests. Pre-existing ERP advisor warnings are outside this release.
- At the earlier checkpoint, team-scoped Vercel management and protected-preview access returned 403. The evening continuation below records the working exact-ID connection and actual hosted results.

Sources: [Vercel Next + Python](https://vercel.com/kb/guide/how-to-use-python-and-javascript-in-the-same-application), [Supabase Storage operation helpers](https://supabase.com/docs/guides/storage/schema/helper-functions), [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Hosted continuation — 2026-10-19 evening

- The personal Vercel connection `kimkl5463@gmail.com` resolves to `titanomics` and the correct project `prj_EADxpZc5HWAZOp10IuVbUlrqwXvH`. Project/deployment ID queries work without an explicit team selector; explicit team-scoped calls and the automatic protected-preview helper still return 403. A direct temporary share-link request for the verified deployment ID works. Tokens and browser sessions are kept in memory, not stored in the repository.
- Preview `dpl_29eFBPjEfk7Vx12pLXhqVrxdewRM` is commit `406f516`. Its actual Python GET returns 405 and anonymous POST returns 401, both with engine fingerprint `6bbd373d7a018cc3241a20b47fb15e53d0a7a071a09d753743af0c5ff868f2eb`, matching the local Next/Python version. The Next access API also rejects anonymous requests with 401. Both Preview and Production public Supabase URLs point to `aniymyjlxctiqhhhfsjh`.
- A normal ERP administrator login succeeded. At 22:09:04 KST the first synthetic clinic registration failed: PostgreSQL logged `new row violates row-level security policy for table "ha_clinics"`. At 22:10 KST both clinics and snapshots still contained zero rows; no Excel upload had begun.
- The failure reproduces against the real isolated PostgreSQL policies: `INSERT ... RETURNING` checks the read policy while the STABLE `ha_can_access` lookup cannot see the inserted row. The route now generates the UUID on the server, performs an insert without returning a row, and returns that UUID only after the insert succeeds. Existing RLS and triggers remain unchanged; no production migration is required or replayed.
- Regression evidence: the new clinic-registration browser check failed on the previous route, then all 9 local browser groups passed after the change. All 40 isolated PostgreSQL checks, TypeScript, and lint for the changed route passed. These local checks do not establish that the follow-up Preview or production release works; hosted registration, upload/persistence, report and non-admin role checks remain release gates.

## Limited-release evidence — 2026-10-19 22:34 KST

- Follow-up Preview `dpl_Gq5sL18G3oyKmUMsYNNwFvsHrnnB` is commit `cb292f7`, READY with a successful Vercel check. A normal ERP admin created a clinic through the UI with HTTP 201. The deployed Python fingerprint still matches `6bbd373d7a018cc3241a20b47fb15e53d0a7a071a09d753743af0c5ff868f2eb`.
- Hosted UI verification on synthetic clinic `cb479dbb-ef01-47de-9971-2db7138aff91` passed both Excel formats, preview/commit, fresh-request persistence of 6 synthetic patients, populated/zero-patient map regions, HTML download (77,254 bytes), PDF (145,493 bytes), foreign-Origin write denial and unknown-clinic denial. No real patient files were used.
- The first snapshot upload at 22:17:15 KST received Supabase Storage HTTP 500 / PostgreSQL `42P10`: its internal `UpsertObject` used `ON CONFLICT (name,bucket_id)` without a matching unique constraint. XLSX reading had succeeded. Later writes succeeded without schema or policy changes. A local diagnostic POST also committed one synthetic snapshot; that local result is not counted as hosted evidence.
- A second clinic, `ad6d2800-6f6c-4aeb-a6b2-36283ffc18e2`, was created and initialized entirely through the hosted app, with no local dispatch. Both Excel imports, reload, map and report checks passed. One empty HTML artifact was observed while multiple CDP clients were attached; an isolated UI download and direct HTTP request independently returned the correct 77,254-byte report, and its PDF was 145,350 bytes. Storage logs from 22:29–22:32 KST contained 8 successful uploads and no errors for these analytics objects. The earlier Storage failure's platform-level cause remains unconfirmed; do not alter managed Storage indexes or replay the completed HA migrations as a workaround.
- At the user's direction, only 전형진 is assigned among ordinary employees. Admin UI assignment succeeded for the first labelled synthetic clinic, with `editor` permission; the second clinic remains admin-only. At 22:32 KST an actual authenticated-database-role simulation verified his assigned-clinic access, denial of the other clinic/admin audit, and zero memberships for other staff. This is not a real login/session test.
- The user cannot provide 전형진's login now. His actual hosted login/use remains unverified. The independent reviewer accepted an admin-led limited release with this explicit limitation, existing live rollback/40 isolated SQL/9 local browser checks, the fresh hosted admin flow, and no recurrence of Storage errors. Do not describe this as all-role hosted end-to-end completion.
- The two labelled synthetic clinics and their private immutable objects are retained as verification evidence. There is no application deletion route; no Storage metadata or existing business data was deleted. For real use, an admin registers the actual clinic and assigns 전형진 through **병원 · 담당자 관리**. Other ordinary employees remain unassigned.
- Production deployment and production-domain checks are the next release step; Preview success alone does not establish production success. Rollback target before release is `dpl_D4TRQ8Hr8jcZqkJGxiGcVtJP2ZqP` (commit `d4af7c8`).
