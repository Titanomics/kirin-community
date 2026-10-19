# Hospital analytics integration implementation plan

> **For agentic workers:** Use superpowers:executing-plans. The user has already authorized continuous implementation; do not ask for another design approval.

**Goal:** Run Excel import, patient-count regional maps, marketing analysis, and interactive HTML / printable PDF reports inside the existing ERP, available to active ERP admins and explicitly assigned employees only.

**Architecture:** Keep Supabase authentication and add RLS-protected clinic memberships. Reuse the verified Python analytics engine in a Vercel Python function behind an authenticated Next.js route. Store per-clinic versioned workspace snapshots and uploads in private Supabase Storage; publish the current snapshot through a transactional compare-and-swap database function. Each request restores a separate temporary workspace and commits only a successful mutation. No serverless filesystem is treated as durable storage.

**Tech Stack:** Existing Next.js 16 / React 19 / Supabase SSR, Python 3.12+, openpyxl, PostgreSQL RLS, private Supabase Storage.

**Spec:** User requirements in this conversation, confirmed 2026-10-19: all existing admin accounts + specifically selected employees; full Excel-to-analysis-to-report flow. Zero-patient regions have no purple fill; greater unique-patient counts produce darker purple, amounts remain available on selection.

## Global constraints
- No patient files, patient rows, local credentials, current clinical workspaces, or generated real reports enter Git.
- Existing ERP roles and authentication stay authoritative. Team membership and existing hospital assignee fields do not grant analytics access.
- Every request fails closed on auth/profile/membership lookup errors, including direct runtime and storage access.
- A revoked/resigned user cannot read or write on subsequent requests. Viewers cannot modify data. Admins manage memberships.
- Existing local app and its data remain intact. Source files are copied using explicit allowlists only.
- Cloud CLI-based AI generation and PC-local backup/scheduling must not falsely claim to be connected. Core data, manual marketing operations, and reports work independently of them.
- Production migration/deployment verification requires the correct Vercel team and Supabase project connection. Current Vercel connector has returned 403 for titanomics-projects; never substitute a different project.

## Review focus
1. A user changes a clinic UUID in a URL, upload path, or snapshot commit: reject without revealing another clinic.
2. Two users edit the same snapshot: only one CAS commit succeeds; the loser receives a conflict and cannot overwrite.
3. A function cold-starts between preview and commit: pending import state and file timestamps survive restoration.
4. Oversized/malicious snapshot archives or missing objects: fail without initializing an empty replacement workspace.
5. HTML/PDF report exports contain only the selected clinic, remain frozen, and assets / APIs cannot be accessed anonymously.

## Task 1 — Durable storage and authorization
Files: `supabase/migrations/20261019090646_hospital_analytics.sql` (filename aligned to applied Supabase version), `tests/analytics/test_sql_security.py`, `lib/hospital-analytics/access.ts`, `lib/hospital-analytics/http.ts`.
- [x] Add active-profile admin checks, clinic membership checks, clinic/state/membership tables, and strict private-bucket policies.
- [x] Add atomic `ha_commit_snapshot` requiring the expected revision, own clinic object prefix, and write membership.
- [x] Verify synthetic admin/editor/viewer/unassigned/resigned principals in a real isolated local PostgreSQL cluster, including restrictive policies against a preexisting permissive storage policy.
- [x] Implement server auth helpers returning 401, 403, or 503 without fallback authorization.

## Task 2 — Reuse the engine with cloud persistence
Files: `analytics_runtime/`, `api/analytics_runtime.py`, `scripts/sync-analytics-engine.py`, `tests/analytics/test_cloud_runtime.py`, `requirements.txt`, `vercel.json`.
- [x] Copy only Python code, static UI, public regional reference data, and the public road dictionary; write a source-hash inventory.
- [x] Use user JWTs to verify identity and access through Supabase; never use a service-role bypass.
- [x] Restore clinic-specific snapshots into per-request temporary directories, preserve nanosecond timestamps and pending preview state, reject unsafe archive entries and excessive size.
- [x] Dispatch existing authorized engine routes and persist successful writes via immutable object upload and database CAS.
- [x] Verify cold-start import/preview/commit, restart persistence, stale writes, hostile paths, and two-clinic report isolation using synthetic Excel data.

## Task 3 — ERP user flow
Files: `app/(main)/hospital-analytics/`, `app/api/hospital-analytics/`, `components/Sidebar.tsx`, cloud `scope.js` / `agency.js` adapters.
- [x] Add clinic selection, admin clinic registration, employee assignment/revocation, and editor/viewer selection.
- [x] Gate server-rendered pages and every API independently, plus private backend authentication.
- [x] Embed the original analysis UI scoped to one clinic, rewrite its API/asset paths, and replace local account management with ERP navigation.
- [x] Upload large Excel files directly to a private bucket using the verified user's existing JWT (RLS rechecks revocation during the upload), then pass only the object reference to the parser.
- [x] Preserve interactive report download, new-window presentation, and browser PDF printing.

## Task 4 — Verification and release preparation
Files: `tests/analytics/`, `docs/hospital-analytics-deployment.md`.
- [x] Run Python integration, real SQL RLS, TypeScript checks, lint for changed files, and a production Next build with synthetic environment configuration.
- [x] Exercise browser upload → preview → commit → map → report → HTML/print flow against a synthetic local auth/storage service; also anonymous and wrong-clinic access.
- [x] Obtain independent Codex code review, fix substantive findings, and rerun affected checks.
- [ ] Apply and verify the actual Supabase migration, package the Python function on Vercel, and exercise the deployed flow. The team/project identity is verified, but the available Vercel connection returns 403 and the actual Supabase owner connection is unavailable. No production release has occurred.

## Execution ledger
- 2026-10-19: Repository verified as Titanomics/kirin-community, baseline d4af7c825d3bbbe296f3fa4cc090645b55bb28d7. Isolated clone branch feature/hospital-analytics-access. Dependencies installed successfully. Existing authenticated Vercel connector cannot access team_f20EuAsQJUx3tJj4NBm3DWB9 (403).
- Ruling: Reuse the existing Python engine rather than rewriting financial/clinical aggregation in TypeScript; a versioned per-clinic snapshot adapter preserves validated calculations and frozen report behavior. Snapshot size is bounded and writes conflict rather than silently overwrite. Storage/compute costs and retained versions must be measured before broad rollout.

## Final local verification ? 2026-10-19
- Python snapshot/engine integration: 10 passed; SQL suite is intentionally separate.
- Real isolated PostgreSQL 18.6: 30 passed, including concurrent CAS writers and broad preexisting Storage-policy fences. Independent reviewer evidence: `.local/analytics-sql-security-results.txt`.
- Actual Next browser ? Python ? synthetic auth/storage: all 7 flow groups passed, including two Excel formats, retained counts, zero-patient transparency, HTML/PDF, admin assignment/revocation, viewer separation, and anonymous denial. No actual patient data used.
- Node clinic-navigation test: 1 passed. Production Next build passed with 25 pages and new dynamic routes. TypeScript and new-module ESLint passed. Existing Sidebar effect lint issue remains preexisting.
- Independent Codex reviewer: no remaining P1/P2 findings. Inventory 83 files verified; copied-file tampering rejected by both Node and Python; cross-runtime fingerprint matched.
- Staged-file audit: 119 files, 0 clinical Excel/PDF/SQLite workspace files, 0 detected credential-pattern files. The one compressed database is the explicitly allowlisted public postal-road reference. Whitespace check passed with CRLF-aware attributes for vendored source.
- Deployment remains pending the ERP owner team's Vercel connection and actual Supabase profile-policy/preflight/migration verification. Local subscription-CLI AI tasks and unattended PC monitors have not been connected to cloud execution.
