# ClipFlow implementation plan

The [product specification](PRODUCT_SPEC.md) records the local first roadmap. Phases 4–6 add the worker, official Google and Meta providers, and the Integration Setup Center. Stop before Phase 7 Gemini generation and templates.

| Phase | Deliverables |
| --- | --- |
| 1. Design foundation | Preserve the starter framework setup. Record the spec, create the theme and reusable components, ship the Overview and navigation shell, and validate both themes, keyboard behavior, and layout at 390 px. |
| 2. Local library | Prisma and SQLite migrations, persistent files, streamed manual MP4 uploads, playback and thumbnails, deduplication, functional library and storage settings, real Overview data, and zero data publishing routes. |
| 3. Drafts and analytics groundwork | Five step editor, persistent local drafts and calendar plans, text history and working-media retention, YouTube Analytics dashboard and official API adapter. |
| 4. Publishing engine | Wire up durable jobs, worker and scheduler, safe mock publishing, cancellation, recovery, quota enforcement, and Needs Review. |
| 5. YouTube | Official channel OAuth, resumable publication, native scheduling and analytics. |
| 6. Instagram and setup | Official Instagram Reels through Facebook Login for Business, plus integration setup and Gemini key/model checks. |
| 7. Generation and templates | Gemini generation and reusable content templates. Keep external imports optional and deferred. |
| 8. Final quality | Review local security and all screens, verify the full product with mock adapters, and document startup, diagnostics, restarts, and backups. Docker remains optional. |

## Phase 1 baseline

- Windows build 26200, Node.js 24.12.0, npm 11.6.2; App Router on Next.js 16.4.6, React/React DOM 19.3.0, Tailwind 4.3.3, and TypeScript 5.9.3 from the lockfile. Node meets the installed Next.js minimum. Keep the Next-generated AGENTS block intact.
- The project-local `landing-page-design` skill is present and registered in `skills-lock.json`. Its installed directory contains the complete `SKILL.md` and no companion files or scripts. No third party skill scripts were run.
- The starter Tailwind Turbopack loader failed to connect to its CSS subprocess on Windows. Use the installed Next.js guide's documented PostCSS integration. Bundle Manrope and Geist Mono locally to avoid remote font downloads during builds. Use server compatible Phosphor imports in server components, a `next-themes` client provider, and project-owned shadcn-style primitives with Radix for the drawer.
- The Overview shows zero data and identifies unavailable functionality. Imports, publishing, worker, and live account health and quotas need their respective later phases. No provider credentials are needed to launch Phase 1.

## Phase 1 verification

- Lint, Next route type generation and strict TypeScript, and the Turbopack production build passed. The production build used regular Windows execution because the sandbox prevented the CSS helper from connecting.
- Reviewed production Edge captures at 1440 px in light and dark mode and at 390 px in dark mode. Browser checks passed for local fonts, empty states, planned actions, 248/64 px sidebar persistence, light/dark/system theme persistence, no horizontal overflow at 390 px, skip link, drawer keyboard focus and Escape, the branded 404, and console errors and warnings.
- `npm audit --omit=dev` reported no runtime findings. The full audit reported 14 high severity findings under the starter ESLint dependency tree; those dependencies were not upgraded as part of this phase.

## Phase 2 implementation

- Manual MP4 upload, playback, library management, thumbnails, real dashboard data, and storage diagnostics are implemented. All approved routes are enabled; publishing tools remain unavailable.
- Prisma 7.10.1, compatible SQLite adapter, Node.js 24, FFmpeg and FFprobe 9.0.2 on this workstation. FFmpeg and FFprobe remain optional at runtime.
- Auditing found 14 development entries stemming from one [picomatch advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) and its ESLint dependency chains. The registry offered no patched releases in the installed 2.x and 4.x branches. npm proposed downgrading the Next.js lint config from 16.4.6 to 14.2.35, which is not a compatible fix. No forced dependency changes were used. The production-only audit reported zero advisories.

## Phase 2 verification

- Phase 2 is complete. Lint, TypeScript, production build, and the isolated HTTP and Edge test passed. The existing loopback development server served Overview, Clip Library and Settings successfully.
- The test used generated MP4s, its own SQLite file and media directories, and a separate loopback port. It verified clean migration, single and batch upload, a valid upload over 10 MB, size and container validation, duplicate and interrupted uploads, restart persistence, pending analysis and retry, generated thumbnails and metadata, byte ranges and browser seeking, search and sort, view persistence, rename, download, individual and bulk deletion, source file preservation, and storage totals.
- Verified matching local request origins, rejection of foreign hosts and traversal inputs, and refusal to serve hard linked files. Reviewed the desktop light library and mobile dark library, upload dialog and Overview. All approved routes were checked at 390 px for overflow. No real media or accounts were used.

## Phase 3 implementation

- `20261118010000_planning_analytics` adds draft, post and destination, social account and group, text history, settings, and analytics tables; one nullable retention timestamp is added to Clip. No destructive reset or media migration.
- The wizard saves incomplete or reviewed drafts. Calendar manages local planned dates independently of actual jobs. History is filterable and remains after media removal. Retention settings are saved now; no automatic cleanup runs in the app.
- Analytics supports preset or custom dates, channel comparison, metrics, charts, and a sortable video table. The official adapter and cache are tested with stubbed data. OAuth and live refresh are unavailable. Combined totals and derived net growth follow YouTube policy restrictions. No dependencies were added.

## Phase 3 verification

- Lint, strict TypeScript, the Turbopack production build, and all five automated tests passed. The additive migration applied to the workspace database; Prisma reported no schema drift.
- Tests used generated videos and disposable SQLite files and media directories. They covered the wizard and per-clip metadata, edits and restart persistence, missing media, timezone and bulk plans, calendar changes, retention safeguards, and text history after cleanup. Analytics tests used stubbed Google responses and checked cache deletion, date filters, hidden subscribers, reported zeroes, and missing dates.
- Reviewed desktop light and 390 px dark screenshots with the landing-page-design skill. Verified the new routes fit at 390 px. No real videos were published, and no existing media was deleted.

## Phases 4–6 implementation

- Phase 4 connects the confirmed five-step wizard to the SQLite queue. A separate process claims destination jobs with leases, applies quotas and retry backoff, recovers resumable checkpoints, and removes managed media after every destination has a verified result. Calendar and Queue read the confirmed schedules. Default missed-schedule behavior requires manual review.
- Phase 5 implements Google authorization, channel-based identities, refresh, resumable YouTube publishing and optional native scheduling. The Analytics dashboard reads authorized reports through the same channel credentials.
- Phase 6 implements Meta authorization using Facebook Login for Business, professional accounts linked to Pages, and the Instagram Reels container and resumable-upload workflow. The HTTPS listener is limited to the callback on loopback.
- Integrations manages encrypted credentials, provider health, Gemini key and model validation, and local runtime settings. The additive migration `20261118020000_durable_publishing` was applied to the workspace database without schema drift. No dependencies were added.
- Live verification requires provider credentials and configuration, an eligible Meta app and trusted localhost certificate, and separate user approval for any live publication. See the [setup guide](INTEGRATIONS.md). Gemini content generation and external imports remain deferred.

## Phases 4–6 verification

- Lint, route type generation, TypeScript, the production build, and all six tests passed. Edge exercised the composer confirmation, queue pause, resume and cancellation, Calendar, retention and History, and populated Analytics. Integrations was reviewed in desktop light mode and 390 px dark mode. Automated verification used generated media, isolated SQLite databases, and mocked provider responses.
- The combined production launcher reported an online worker and shut down correctly. A disposable localhost certificate verified the restricted HTTPS listener and invalid OAuth state rejection. The occupied default web port was left alone during the smoke test.
- The production-only npm audit returned zero vulnerabilities. The full audit still reported 14 development advisories in the existing ESLint dependency tree. The suggested breaking downgrade was left out.

## Final release checklist

| Area | Release scope | Verification |
| --- | --- | --- |
| Local workspace | MP4 import and playback, persistent drafts, groups, calendar and confirmed publishing queue | Isolated SQLite and media fixtures, Edge interactions |
| Gemini | Saved key and selected model, structured text suggestions, batching, cancellation and cache, optional confirmed inline video input | Model metadata checked live. Generation uses mock responses in tests |
| Templates | Create, edit, duplicate, delete, find, set defaults, and apply templates or presets, including saving metadata from History | Isolated persistence and browser workflows |
| Google | Account identities, OAuth scopes and refresh persistence, account diagnostics, cached YouTube Analytics and optional refresh | OAuth identity and Analytics reads were exercised separately. Automated refresh and publishing tests use mocks |
| Instagram | Official Facebook Login for Business and resumable local Reels upload | Mocked account and publishing lifecycle. Requires Meta app credentials, permissions, and a trusted callback to verify live |
| Worker and storage | Leases, restart recovery, quotas, retries, publication verification, confirmed manual cleanup, and storage metrics | Isolated worker and publishing tests. Live publishing requires separate user approval |
| Release | Semantic status tokens, accessible dashboard controls, additive migration, startup and recovery guidance | Lint, types, production build, browser and security audit |
| Optional integrations | Google Drive, SupoClip, and external import adapters | Deferred |

Release verification passed lint, TypeScript, the Turbopack production build, and all six automated tests. The browser suite included keyboard focus restoration, templates and account group selection, AI preview and draft persistence, manual cleanup confirmation, responsive routes, and semantic statuses in both themes. The isolated production launcher reported worker health, served the callback through a temporary localhost certificate, rejected invalid OAuth state and foreign mutation origins, and shut down cleanly.

Migration `20261118030000_release_workflows` is additive. Verification checked that account records and encrypted credentials survived an upgrade. The direct SDK dependency is `@google/genai` 3.6.0. At the time of this phase, the runtime audit reported zero vulnerabilities and the full audit reported 14 high severity development findings in the ESLint dependency tree.

### YouTube review and audio transcription follow-up

YouTube review now links missing or invalid metadata directly to the editor, offers the clip name as a title, and uses People & Blogs for an unset category. The audience decision remains explicit. AssemblyAI uses the existing encrypted integration settings. The composer supports an entered description, a pasted transcript, or a confirmed audio-only AssemblyAI request. Its editable result is included in the selected Gemini generation request.

Lint, TypeScript, the production build, and all six tests passed. Browser fixtures covered the blocked draft, category fallback, audience selection, queue confirmation, and edited transcript handoff. The provider fixtures exercised FFmpeg extraction and mocked AssemblyAI upload, polling, and deletion. Live read-only checks confirmed the new controls and worker on port 3002. Live AssemblyAI and YouTube publishing remain unverified.

### Simplified publishing and provider recovery

Review now allows editing the title, audience, and visibility in place. The server uses the clip name when the title is blank. Immediate drafts can go straight from Prepare content to Review. The composer lets users explicitly choose a Gemini model for the current session. A live synthetic check reproduced Google HTTP 503 for the saved 3.8 Flash model and succeeded with 3.1 Flash-Lite using the same key.

Verified that the rebuilt Integrations route recognizes AssemblyAI and the worker reports online. Lint, TypeScript, production build, and all six isolated tests passed. Live uploads and AssemblyAI transcription were outside that test run.

### AssemblyAI upload reference fix

ClipFlow passes the HTTPS reference returned by AssemblyAI back to its transcription API verbatim. This supports changes to the upload host, path, and signature. Lint, TypeScript, the production build, and all six isolated tests passed. The regression test uses generated media and mocked AssemblyAI responses to cover both URL formats, invalid references, polling, and cleanup. Live transcription was outside that test run.

### Publish confirmation and clip reimports

The confirmation dialog defaults to keeping the selected clips and offers removal once every destination succeeds and no draft or outstanding post needs the files. The migration releases duplicate checksums held by removed clips and retires pending cleanup requests created before this choice was available. Publication history remains linked to the original records. An upload matching a published clip still in the library reuses that working copy.

Lint, TypeScript, the production build, and all six isolated tests passed. Verification covered desktop and mobile confirmation, mocked publishing with both retention choices, draft protection, and reupload before and after removal. The migration preserved existing records.

### Open source release preparation

An isolated Windows checkout passed the locked dependency install, migrations, lint, TypeScript checking, the production build, and all six automated tests. A separate production smoke test started with empty local tables, brought the worker online, saved a synthetic integration credential without exposing it in browser output, and imported a generated MP4. The README screenshots came from the isolated demo and test workspaces. The GitHub Actions workflow runs validation on Ubuntu. Provider verification in CI uses mocks.
