# ClipFlow — Master Implementation Specification

## Revised roadmap

The final release adds Gemini suggestions and optional, consent based inline video analysis, reusable metadata templates and publishing presets, local account diagnostics, configurable analytics refresh, and confirmed manual cleanup. Preserve all existing local data and authorization. Keep the workspace private and bound to loopback. Live verification and external authorization requirements are tracked in the [implementation plan](IMPLEMENTATION_PLAN.md).

The combined Phase 4–6 milestone adds durable publishing, official YouTube and Instagram OAuth and publishing adapters, authenticated YouTube analytics, and an Integration Setup Center. Gemini key and model validation is included; generation and templates move to Phase 7. External import adapters remain deferred.

The Phase 3 brief adds the complete local wizard, persistent drafts and planned calendar items, text publication history, configurable working-media retention, and a dedicated YouTube Analytics section. No app login, Supabase, cloud database, live publishing, OAuth, Gemini, or external imports are introduced in Phase 3. Phase 4 is the durable worker; real YouTube authorization and live analytics follow. Keep manual MP4 import primary and independent.

Keep media by default, including after publication. The publishing confirmation offers removal of managed video and thumbnail copies after all destinations have verified success and no active draft or unsettled post needs the files. Keep text and numerical publication records. Reimporting a removed clip creates a new working copy, and uploading a published clip that is still in the library reuses the existing copy.

The Phase 2 brief supersedes the original Phase 2 and Phase 3 descriptions below. Phase 2 implements manual MP4 uploads from any editor, Prisma and SQLite, local files, video previews and thumbnails, the Clip Library, Overview data and storage diagnostics, and zero data publishing screens. Phase 3 implements the five step wizard and persistent post drafts. No real publishing, OAuth, Gemini, or external imports are in Phase 2.

Local uploads do not depend on clipping software. SupoClip, Google Drive, and watched folders are optional future import sources. The SupoClip requirements below apply only if that adapter is later implemented and enabled.

Activate $landing-page-design immediately.

Locate and read the complete installed landing-page-design SKILL.md and its relevant reference files before designing or implementing any UI.

Act as a senior full-stack engineer, product designer, software architect, and security engineer.

Your task is to build ClipFlow, a complete, functional, local-first social media publishing web application.

The product concept, design direction, and requirements have already been planned and approved. Implement the approved specification without independently changing its visual identity, product workflow, or architecture.

## 1. Inspect the existing project

Before implementation:

- Inspect the current workspace and existing files.
- Detect the operating system, Node.js version, Next.js version, package manager, and installed dependencies.
- Verify the landing-page-design skill is available.
- Read existing project instructions.
- Preserve existing valid configuration.
- Review the third-party skill before executing any referenced scripts.
- Identify potential compatibility issues.
- Create AGENTS.md, docs/PRODUCT_SPEC.md, docs/DESIGN_SYSTEM.md, docs/ARCHITECTURE.md, and docs/IMPLEMENTATION_PLAN.md.

Record this specification in the project documentation so future Codex sessions can continue consistently.

Do not ask me to repeat already approved design decisions.

## 2. Product identity

Application name: ClipFlow

Tagline: One clip. Every channel.

Product concept: A professional personal creator studio that imports short-form video clips, generates posting metadata, and publishes them across multiple YouTube and Instagram accounts.

Target user: One administrator using the application personally.

Application language: English.

This is an operational dashboard, not a public marketing website.

Do not create a marketing homepage, pricing page, testimonials, signup page, login page, or promotional sections.

The homepage must be the Overview dashboard.

## 3. Core requirements

- Support 6–10 YouTube channels.
- Support 6–10 Instagram Creator or Business accounts.
- Handle 6–20 original clips per day.
- Support up to 400 destination publishing jobs per day, subject to provider quotas and account limits.
- Import MP4 videos from local files. Google Drive, SupoClip, and watched folders are optional later sources.
- Automatically detect clips only when an optional adapter and automation are configured.
- Support instant, bulk, scheduled, and configurable automatic publishing.
- Provide manual and Gemini-generated titles, descriptions, captions, tags, and hashtags.
- Use a step-by-step publishing wizard.
- Support reusable account groups and content templates.
- Provide light, dark, and system themes.
- Target zero additional recurring software costs.
- Use official platform APIs only.

## 4. Approved visual direction

Build a minimal monochrome professional creator studio.

Activate and follow $landing-page-design throughout all frontend implementation.

Apply the skill's relevant design-system, typography, composition, accessibility, responsive design, and quality-review instructions.

Adapt marketing-specific guidance to an operational dashboard. Explicit approved ClipFlow requirements take precedence over marketing-specific layouts and promotional patterns.

If a skill recommendation conflicts materially with the approved specification, document the conflict instead of silently changing the design.

Avoid generic AI-generated aesthetics.

Do not use:

- Purple or colorful brand accents.
- Decorative gradients.
- Glassmorphism.
- Glowing buttons.
- Oversized dashboard headlines.
- Excessive rounded containers.
- Generic SaaS marketing components.
- Fake analytics or fabricated testimonials.
- Excessive animations.
- Stock photos used merely as decoration.

Use the user's actual video thumbnails as the primary visual content.

## 5. Design tokens

Dark theme:

- Background: #181818
- Surface: #1F1F1F
- Elevated surface: #272727
- Border: #343434
- Primary action: #F5F5F5
- Primary text: #FAFAFA
- Secondary text: #A3A3A3
- Primary action text: #181818

Light theme:

- Background: #F7F7F7
- Surface: #FFFFFF
- Elevated surface: #F0F0F0
- Border: #E5E5E5
- Primary action: #181818
- Primary text: #171717
- Secondary text: #666666
- Primary action text: #FFFFFF

Functional color references:

- Success: #22C55E
- Warning: #F59E0B
- Failed: #EF4444
- Scheduled: #3B82F6
- YouTube: #FF0033
- Instagram: #D946A0

Adjust semantic foreground shades where necessary to achieve accessible contrast. Never rely on color alone to communicate status.

Typography:

- Primary font: Manrope.
- Technical font: Geist Mono.
- Page titles: 30px, weight 600.
- Section titles: 18px, weight 600.
- Body: 14px.
- Button text: 14px, weight 500.
- Metadata: 12px.
- Use tabular numbers for statistics and durations.

Layout:

- Expanded desktop sidebar: 248px.
- Collapsed sidebar: 64px.
- Header: 64px.
- Main content padding: 24–32px.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48px.
- Cards: 12px corner radius.
- Buttons: 8px corner radius.
- Phosphor Icons with consistent weights.
- Restrained interaction transitions around 150–300ms.
- Respect prefers-reduced-motion.

Implement all theme tokens centrally using CSS custom properties.

Create a lightweight monochrome SVG logo using a geometric video/play symbol. Avoid unnecessary decorative assets.

## 6. Technology stack

Use stable, mutually compatible versions of:

- Next.js App Router
- TypeScript strict mode
- Tailwind CSS
- shadcn/ui
- Phosphor Icons
- next-themes or equivalent theme management
- Prisma ORM
- SQLite
- Zod
- Official Google Gen AI SDK
- Official Google API client libraries
- FFmpeg and FFprobe
- Vitest
- Playwright

Use a separate long-running Node.js worker for persistent background operations.

Do not require Redis, Supabase, Ollama, Firebase, paid cloud storage, or paid publishing services.

Support native local development first. Docker Compose may be added as an optional deployment method later.

## 7. Application shell

Create a persistent expanded desktop sidebar with collapsing functionality.

Navigation sections:

WORKSPACE

- Overview
- Clip Library
- Create Post
- Calendar
- Publishing Queue

MANAGEMENT

- Accounts
- History
- Templates
- Settings

Sidebar footer:

- Worker connection status.
- Local workspace indicator.
- Collapse sidebar control.

Header:

- Page title or breadcrumb.
- Search when functional.
- Theme switcher.
- Relevant page actions.

Do not add fake profile menus or authentication controls.

On mobile, use an accessible drawer navigation and responsive layouts.

Persist theme and sidebar preferences.

## 8. Overview dashboard — /

Create a useful operational dashboard containing:

- Connected account count.
- Ready clip count.
- Published today count.
- Pending publishing job count.
- Recent clips with actual video thumbnails.
- Current publishing queue.
- Upcoming scheduled posts.
- Failed jobs requiring attention.
- Account connection health.
- SupoClip integration status.
- Daily publishing quota usage.
- Create Post and Import Clips actions.

Use actual database values.

In the initial frontend phase, clearly label demonstration fixtures and keep them separate from production data.

Provide appropriate zero-data empty states.

## 9. Clip Library — /clips

Build a complete video management workspace.

Features:

- Grid and list views.
- Search and filtering.
- Source filters: All, Local, SupoClip, Google Drive.
- Sorting by date, name, duration, and file size.
- Multiple clip selection.
- Video preview.
- Vertical thumbnails.
- Duration and resolution information.
- Imported date and source.
- Publishing history for each clip.
- Create Post action.
- Bulk actions.
- Safe deletion.

Import locally uploaded MP4 files using streaming or appropriately chunked file handling.

Use FFprobe for media validation and FFmpeg for thumbnail generation and optional normalization.

Store video files on the filesystem.

Deduplicate imported videos using stable source identifiers and checksums.

Do not delete files referenced by pending jobs or scheduled posts.

## 10. Publishing wizard — /compose

The publishing interface must be a five-step wizard rather than a single-page composer.

Step 1: Select clips

- Select one or multiple videos.
- Preview videos.
- Show duration and platform compatibility.
- Allow import if the library is empty.

Step 2: Select accounts

- Group accounts by YouTube and Instagram.
- Select individual accounts.
- Select reusable account groups.
- Select all eligible accounts.
- Display disconnected accounts and explain why they are unavailable.

Step 3: Prepare content

- YouTube title, description, category, tags, visibility, audience, and applicable disclosures.
- Instagram caption and hashtags.
- Generate metadata using Gemini.
- Support manual editing.
- Apply templates.
- Support platform-specific and per-account overrides.
- For multiple clips, support individual metadata and batch generation.

Step 4: Scheduling

- Publish now.
- Schedule date and time.
- Bulk scheduling with start date and interval.
- Show dates in the configured timezone.
- Estimate destination jobs and quota usage.
- Display scheduling conflicts and unavailable accounts.

Step 5: Review

- Preview selected videos.
- Review the final metadata for each platform and destination.
- Review destination accounts.
- Review publishing times.
- Review validation warnings and quota requirements.
- Confirm publishing or scheduling.

Preserve the user's input when navigating backward.

Autosave drafts locally in the database when appropriate.

Use a clear progress stepper, Back and Continue actions, and a prominent final publication action.

## 11. Accounts — /accounts

Build connected account management.

Features:

- Connect YouTube account.
- Connect Instagram account.
- Reauthorize expired or revoked accounts.
- Display account name, platform, avatar, and stable remote account ID.
- Show connection health.
- Disconnect account.
- Account grouping.
- Create, rename, edit, and delete groups.
- Show publishing limits where available.
- Show relevant account-level errors.

Deduplicate connections using stable remote account identifiers, not email addresses.

Never ask for social media passwords.

Use official OAuth flows.

## 12. Calendar — /calendar

Provide monthly and weekly views.

Features:

- Display scheduled clips and destinations.
- Filter by platform and account group.
- Show local timezone.
- Reschedule pending jobs.
- Cancel eligible scheduled publications.
- Open publication details.
- Display scheduled, processing, published, and failed states.

Store timestamps in UTC.

Default display timezone: Asia/Kolkata.

Use an accessible date and time selection interface.

## 13. Publishing Queue — /queue

The queue is a core operational page.

Provide:

- Pending jobs.
- Scheduled jobs.
- Active uploads.
- Processing jobs.
- Retry waiting jobs.
- Failed jobs.
- Needs Review jobs.
- Completed jobs.

Each row should show:

- Clip thumbnail and filename.
- Destination account.
- Platform.
- Scheduled time.
- Status.
- Actual progress where supported.
- Attempt count.
- Error summary.
- Available actions.

Provide pause, resume, cancel, retry failed, retry selected, and inspect error details.

Do not display invented upload percentages when a provider does not expose progress.

Never retry successfully published targets.

## 14. Publication History — /history

Provide a searchable and filterable publication table.

Include:

- Clip information.
- Destination account.
- Platform.
- Published timestamp.
- Remote media ID.
- Direct link when available.
- Final publication status.
- Metadata used.
- Attempt history.

Clearly distinguish upload acceptance, processing, scheduling, and actual successful publication.

## 15. Templates — /templates

Support saving, editing, duplicating, and deleting templates.

Template types:

- YouTube titles.
- YouTube descriptions.
- Instagram captions.
- Hashtag collections.
- Gemini generation instructions.
- Platform-specific publishing defaults.

Support documented placeholders such as clip name, source title, transcript context, and date.

Validate templates before use.

## 16. Settings — /settings

Organize settings into sections:

General:

- Theme.
- Timezone.
- Application preferences.

Integrations:

- Gemini.
- SupoClip.
- Google Drive.
- FFmpeg.

Publishing:

- Maximum worker concurrency.
- Per-account concurrency.
- Daily posting limits.
- Retry policy.
- Missed-schedule behavior.
- Default metadata and visibility.

Automation:

- Automatically import SupoClip clips.
- Automatically add imported clips to the publishing queue.
- Automatically generate Gemini metadata.
- Default account group.
- Default caption template.
- Publishing time window.
- Minimum interval between clips.
- Maximum daily posts.
- Automatic publishing enabled or disabled.

Storage:

- Video storage location.
- Storage usage.
- Database backups.
- Safe cleanup policies.

System:

- Worker health.
- API connection health.
- Service diagnostics.

Do not return sensitive keys or OAuth tokens to the browser.

## 17. Gemini integration

Use the official Google Gen AI SDK, not Ollama or the OpenAI API.

Configure:

- GEMINI_API_KEY
- GEMINI_MODEL

Read current official Gemini API documentation and choose a currently supported free-tier Flash or Flash-Lite model.

Keep the model configurable.

Generate structured output containing:

- YouTube title.
- YouTube description.
- YouTube tags.
- Instagram caption.
- Instagram hashtags.

Validate Gemini responses with Zod.

Use clip transcripts, source metadata, and optional user context.

Do not fabricate facts about video contents.

Prefer one generation request per clip and reuse metadata across applicable accounts.

Cache generation results.

Handle quota errors, network errors, invalid responses, and unavailable models.

Manual editing and publication must remain available if Gemini fails.

Do not silently enable billing, switch to paid models, or require paid features.

Do not send full video files to Gemini by default.

Treat transcripts as untrusted content rather than instructions.

## 18. SupoClip integration

This proposed adapter would connect to a user-operated, self-hosted SupoClip installation. It is outside the release scope.

Do not rebuild its clipping engine.

Implement ClipFlow as a separate companion application.

Inspect the actual installed SupoClip version or available source repository.

Verify real:

- API routes.
- Authentication requirements.
- Completed clip metadata.
- Video download mechanism.
- Transcript availability.
- Storage locations.

Never invent SupoClip API endpoints.

Implement a configurable integration adapter.

Prefer a supported API or webhook when available. Otherwise, implement controlled polling and an optional watched-folder import fallback.

Automatically detect newly completed clips.

Automatically import them into ClipFlow.

Validate media and deduplicate imports.

Create a durable pending automation record for each new clip.

When valid automation settings are available:

- Generate metadata using Gemini.
- Apply the configured template.
- Apply the configured account group.
- Calculate the next eligible posting time.
- Create a destination publishing job for each selected account.

Automatic queueing is enabled when the integration is configured.

Actual automatic publication must require explicit activation of an automation rule containing destination accounts, posting schedule, and metadata policy.

If the rule is incomplete, create a Needs Review item rather than publishing to guessed accounts.

Do not import the same SupoClip clip repeatedly.

Persist integration checkpoints across restarts.

Never modify or delete original SupoClip files without explicit permission.

## 19. Google Drive integration

Use official Google Drive APIs.

Authorize access using the minimum appropriate OAuth scopes.

Allow browsing and selecting supported video files.

Download selected clips safely to the local ClipFlow library.

Preserve source file identifiers.

Handle revoked access, missing files, and failed downloads.

Do not expose Google credentials to the browser.

## 20. YouTube integration

Use the official YouTube Data API v3 and Google OAuth.

Support multiple Google accounts and multiple accessible YouTube channels.

Implement:

- Account selection and authorization.
- Stable channel identification.
- Secure access and refresh token storage.
- Token refresh and reconnection.
- Resumable video uploads.
- Remote video ID.
- Title and description.
- Tags and category.
- Public, private, and unlisted visibility.
- Audience and applicable disclosure settings.
- Scheduled publication.
- Upload reconciliation.
- Provider error handling.

Read the current official documentation and verify all scopes, policies, quota rules, required fields, and scheduling constraints.

The initial expected upload quota is 100 video insertion calls per project per day. Verify actual available quotas before implementation.

Enforce project quotas and channel-specific limits.

Do not rotate API projects or use other mechanisms to bypass quotas.

Document OAuth consent configuration, testing-mode token expiry, verification requirements, and quota extension procedures.

Do not assume every vertical upload will be classified as a YouTube Short.

## 21. Instagram integration

Use official Meta publishing APIs only.

Prefer Instagram API with Instagram Login where it satisfies publishing requirements.

Support eligible Creator and Business accounts.

Verify:

- Current API version.
- OAuth flow.
- Required permissions.
- App access levels.
- App review requirements.
- Account eligibility.
- Token lifecycle.
- Reels publishing limits.

Implement:

- Multiple account connections.
- Stable remote account identification.
- Encrypted credentials.
- Token refresh and reconnection.
- Media container creation.
- Supported video upload method.
- Media processing status polling.
- Final media publication.
- Remote media ID and permalink.
- Publishing limit checks.
- Error handling.

Prefer officially supported direct or resumable uploads when available.

If a publicly accessible video URL is mandatory, document the constraint and implement only an explicitly approved secure media delivery method.

Do not expose the unauthenticated dashboard or entire local video directory publicly.

Do not use browser automation, unofficial APIs, password-based account access, or platform restriction bypasses.

## 22. Durable publishing worker

Implement a separate long-running Node.js worker.

Use SQLite-backed persistent jobs instead of in-memory queues.

Each video and destination account combination must have an independent publishing target and job.

Implement:

- Atomic job claiming.
- Job leases.
- Heartbeats.
- Expired lease recovery.
- Bounded concurrency.
- Retry backoff.
- Per-account rate limits.
- Provider quota handling.
- Pause and resume.
- Scheduled jobs.
- Restart recovery.
- Missed-schedule handling.

Persist relevant resumable upload identifiers and remote publication IDs.

Use logical idempotency keys.

If an external request may have succeeded but its result is uncertain, reconcile the provider state or move the job into Needs Review rather than blindly publishing again.

Respect Retry-After headers.

Never repeatedly retry permanent validation or authorization failures.

Ensure one failing destination does not prevent successful publication to other destinations.

## 23. Database architecture

Use Prisma and SQLite.

Design appropriate models for:

- SocialAccount
- OAuthCredential
- AccountGroup
- AccountGroupMember
- Clip
- Post
- PostTarget
- Job
- PublishAttempt
- CaptionTemplate
- Integration
- AutomationRule
- ImportCheckpoint
- GeneratedMetadata
- QuotaUsage
- AppSetting

Include unique constraints, indexes, foreign keys, and timestamps.

Separate post metadata from destination-specific overrides.

Store immutable publication metadata snapshots where necessary.

Use suitable SQLite transaction handling, concurrency settings, and durable migrations.

Do not add a User model, signup flow, or session authentication in the initial version.

## 24. Security and local operation

There is intentionally no application login or registration.

This does not remove the requirement for secure third-party OAuth.

Bind the development server and production server to localhost by default.

Prevent unauthorized cross-origin requests.

Validate Host and Origin headers where appropriate.

Implement OAuth state verification and PKCE where supported.

Protect callback and mutation endpoints against CSRF.

Encrypt OAuth tokens at rest using authenticated encryption such as AES-256-GCM with unique nonces.

Keep encryption keys and API secrets outside source control.

Protect imports and integrations against:

- Path traversal.
- SSRF.
- Unsafe redirects.
- Arbitrary file access.
- Malicious file uploads.
- Oversized media.
- Shell command injection.

Never interpolate untrusted input into shell commands.

Do not expose credentials in logs, error responses, or client-side bundles.

Do not implement public remote deployment without adding an explicitly approved access-control solution.

Secure remote access and full cloud deployment are later milestones.

## 25. Project organization

Use a clean, modular structure similar to:

- src/app — pages and server routes
- src/components/ui — shared UI primitives
- src/components/layout — application shell
- src/components/dashboard — overview components
- src/components/clips — clip management
- src/components/composer — publishing wizard
- src/components/accounts — account management
- src/lib/db — database
- src/lib/storage — video storage
- src/lib/security — credential encryption and validation
- src/lib/gemini — AI generation
- src/lib/publishers — provider publishing adapters
- src/lib/integrations — SupoClip and Google Drive
- src/lib/jobs — durable queue services
- src/worker — background worker
- prisma — schema and migrations
- data — persistent local data
- tests — automated tests
- docs — project documentation

Adapt exact filenames sensibly to the existing project.

Avoid unnecessary abstractions and dependencies.

## 26. Environment configuration

Create a documented .env.example containing placeholder values for:

- APP_URL
- APP_TIMEZONE
- DATABASE_URL
- STORAGE_PATH
- TOKEN_ENCRYPTION_KEY
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- DRIVE_CLIENT_ID
- DRIVE_CLIENT_SECRET
- META_APP_ID
- META_APP_SECRET
- META_API_VERSION
- GEMINI_API_KEY
- GEMINI_MODEL
- SUPOCLIP_BASE_URL
- SUPOCLIP_AUTH_TOKEN, only if supported by the installed version

Use localhost port 3001 by default.

Ensure the Next.js server and background worker load configuration consistently.

Add environment files, database files, token material, and video storage to .gitignore.

Never ask me to paste actual secrets into the conversation.

## 27. Testing requirements

Write automated tests for:

- Video imports.
- Media validation.
- Duplicate prevention.
- Credential encryption.
- OAuth state validation.
- Local endpoint security.
- Gemini response validation.
- Publishing wizard.
- Job claiming.
- Scheduler.
- Worker restart recovery.
- Partial publication failure.
- Duplicate publication prevention.
- Quota exhaustion.
- SupoClip import checkpoints.
- Automation rule validation.

Use mock provider adapters during automated testing.

Never publish real social media content during automated tests.

Require the workspace operator's explicit approval for live test uploads.

Begin live testing with one account and one video.

## 28. Implementation phases

Phase 1 — Design foundation

- Inspect project and installed design skill.
- Create persistent project documentation.
- Install necessary frontend dependencies.
- Implement approved theme tokens.
- Implement typography and logo.
- Build expanded sidebar and responsive application shell.
- Build Overview dashboard.
- Establish reusable components.

Phase 2 — Complete frontend

- Implement all approved pages.
- Build the five-step publishing wizard.
- Implement responsive layouts and empty states.
- Use clearly separated demonstration fixtures where backend data is unavailable.
- Perform visual review using the design skill.

Phase 3 — Local backend

- Configure Prisma and SQLite.
- Implement database migrations.
- Implement video storage.
- Add local video import, preview, thumbnails, and media validation.
- Replace demonstration fixtures with real data.

Phase 4 — Publishing engine

- Implement durable queue.
- Implement worker and scheduler.
- Add mock publishing adapter.
- Add recovery, retry, cancellation, and quota logic.

Phase 5 — Real publishing providers

- Implement YouTube OAuth and publishing.
- Implement Instagram OAuth and publishing.
- Document credentials and provider setup.
- Stop before any unapproved live publication.

Phase 6 — Gemini and templates

- Integrate free-tier Gemini.
- Implement structured content generation.
- Add caching, templates, and quota recovery.

Phase 7 — Import automation

- Implement SupoClip integration.
- Implement Google Drive imports.
- Add automatic queueing.
- Add configurable automatic publishing rules.

Phase 8 — Final quality and deployment

- Perform security review.
- Run automated tests.
- Review all pages in light and dark mode.
- Verify responsive behavior.
- Remove unnecessary placeholder features.
- Document local startup, backups, restarts, and troubleshooting.
- Add optional Docker deployment documentation.

## 29. Implementation quality gates

At the end of each phase:

- Run lint.
- Run TypeScript checks.
- Run relevant automated tests.
- Verify production build.
- Review relevant pages visually.
- Verify browser console errors.
- Check keyboard accessibility.
- Check dark and light themes.
- Update implementation documentation.

Use $landing-page-design to review frontend work against the approved visual direction.

Work toward a genuinely functional product, not a collection of static screens.

Do not create buttons that pretend to perform unsupported actions.

Clearly distinguish implemented, mocked, untested, and blocked functionality.

## 30. First task

Begin with Phase 1 only.

Inspect the existing workspace and activate $landing-page-design.

Create the specification and architecture documents, then implement the approved monochrome design foundation, expanded sidebar, application shell, and Overview dashboard.

Verify the result using linting, TypeScript checks, build verification, and visual inspection where possible.

Do not connect real social media accounts yet.

Do not configure paid services.

Do not introduce authentication.

Do not change the approved product name, monochrome identity, typography, page structure, or publishing wizard direction.

At completion, summarize:

- What was implemented.
- Files created or modified.
- Dependencies installed.
- Verification results.
- Any blockers.
- How to run the application.
- What remains for Phase 2.

Stop after Phase 1 so I can review the actual dashboard before further implementation.
