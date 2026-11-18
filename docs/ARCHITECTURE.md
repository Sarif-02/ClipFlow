# ClipFlow architecture

## Phases 4–6

Submitting a reviewed draft explicitly freezes its destinations and target metadata in a single SQLite transaction with one job per destination and an idempotency key. The independently started worker claims jobs with leases, writes attempts, and preserves encrypted upload checkpoints. Expired leases recover without blindly reposting. Provider verification and text history precede durable retention tasks. Existing Phase 3 drafts and calendar plans are never queued by migration.

IntegrationConfig stores runtime configuration and encrypted provider credentials. OAuth state is short lived and bound to the initiating browser; credentials are keyed by remote account identity. The worker and Next.js share SQLite, WAL, and the encryption key. See [integration setup](INTEGRATIONS.md) for exact callbacks, policies, server and worker startup, and backups.

## Current local workspace

The App Router reads local clip, draft, history, calendar, settings, and analytics data at request time. Suspense preserves the static shell, and browser storage persists shell preferences. The worker and provider setup are independent of the local library and composer.

## Templates and Gemini

Versioned templates persist in SQLite and can refer to an account group and one content template. Applying a preset copies content and destinations into an editable draft. Final confirmation freezes the resulting metadata and destinations. The composer previews AI suggestions before applying them and can restore the previous content.

The server reads the encrypted Gemini credential and uses the official SDK with structured response validation, two concurrent requests, timeouts, cancellation, and a limited retry budget. Cache keys include the clip checksum, model, template revision, and generation context. The cache stores validated suggestions for seven days. Explicit video analysis uses a bounded inline MP4 of up to 8 MiB and 60 seconds in duration. Prompts, transcripts, and raw video input are never stored in the AI cache.

## Drafts, plans, and media retention

- `PublishingDraft` is one editable wizard collection. Each selected clip becomes a `Post`, and each destination is a `PostTarget`, with an override stored separately from the clip defaults. Revisions prevent stale updates. A text filename survives a broken clip reference. Duplicating copies choices and metadata and asks for new posting times rather than creating duplicate plans.
- The server validates MP4 availability and scheduling inputs before saving Review. Local wall times are converted to UTC; ambiguous and skipped local times are rejected. Calendar can change or cancel individual local plans. Review confirmation validates credentials, media, metadata and quota before creating runnable jobs. Submitted jobs are managed in Queue.
- Confirmation saves each clip's removal request with its associated post in the queue transaction. Keep is the default and clears any previous pending request for that copy. After the requested post succeeds, the worker checks linked drafts, posts and verified destinations before claiming eligible media. The removal operation checks managed paths, supports retry if interrupted, and preserves the Clip and immutable text history.

## YouTube Analytics

- The server-side adapter uses [channels.list](https://developers.google.com/youtube/data/reference/rest/v3/channels/list), [playlistItems.list](https://developers.google.com/youtube/data/reference/rest/v3/playlistItems/list) against the uploads playlist, and [videos.list](https://developers.google.com/youtube/data/reference/rest/v3/videos/list) in batches. [Channel reports](https://developers.google.com/youtube/analytics/channel_reports) provide totals, daily views, minutes watched, subscriber gains and losses, and top video views. Reports use a time-limited local cache.
- The adapter receives a server-only credential callback. It uses the fully qualified `youtube.readonly` and `yt-analytics.readonly` [scopes](https://developers.google.com/identity/protocols/oauth2/scopes#youtube); upload authorization adds `youtube.upload`.
- The SQLite cache holds up to eight snapshots per channel, with configurable age (default 24 hours, maximum 30 days). Reads and worker upkeep clear expired or disconnected entries. Clearing the cache and disconnecting an account remove stored reports. Optional background refresh fetches the last 28 days with a bounded scan during idle worker periods. Manual refresh retains a full inventory scan. Only remote thumbnail URLs are stored.
- Preserve YouTube's [Pacific reporting dates](https://developers.google.com/youtube/analytics/dimensions#Time_Periods) and distinguish unavailable values from zero. Show cross-channel comparisons without combining API data across owners. Keep computed net growth unavailable pending permission for derived metrics. See [YouTube Developer Policies, III.E and III.L](https://developers.google.com/youtube/terms/developer-policies).

TypeScript, Tailwind v4, Cache Components, and partial prefetching remain in place. Both npm server scripts check migration status before acquiring a SQLite write lock for a pending migration. `APP_URL` sets the local port and OAuth origin. The default is port 3001.

## Manual imports and media

- Each request streams one MP4 to a generated staging file and enforces the configured size limit while reading. MP4 structure is checked, SHA-256 detects duplicate content, and FFprobe and FFmpeg extract metadata and previews. Unavailable FFprobe leaves a clip pending analysis; analysing a stored clip can be retried. If FFmpeg alone is unavailable, validated video remains playable without a thumbnail.
- Each validated upload reserves a hidden database row before promoting its files, then makes the row visible. Recovery cleans stale generated temporary files and tracked unfinished imports or deletions. It does not delete unregistered permanent files. Deletion removes only managed copies.
- A checksum reservation is unique while the working copy exists. After verified cleanup the historic checksum remains on the old record, and a matching upload can create a new working copy. Uploading a published clip that still has a working copy returns its existing library entry.
- Media routes validate clip UUIDs and generated paths, reject symlinks and hard links, and stream byte ranges for seeking. Mutations require matching loopback Host and Origin. FFmpeg is invoked with argument arrays, forced MP4 input and external data references disabled.
- Local uploads work without any clipping service. Optional providers can reuse the clip model and validation in a later phase.

## Approved target design

| Layer | Responsibilities |
| --- | --- |
| Next.js app | Overview, Library, five step publishing wizard, Calendar, Queue, Accounts, History, Templates, Settings. Route handlers and server services handle provider callbacks, mutations, and streamed media. Keep current DB state dynamic with the installed Cache Components guidance. |
| Local persistence | Prisma with SQLite for durable records and migrations; a dedicated local directory for originals and thumbnails. Store references, source IDs, and checksums in SQLite rather than video bytes. Use FFprobe for file validation and FFmpeg for thumbnails and optional normalization. |
| Node worker | A separate process shares SQLite and storage with the web app. It claims due jobs with leases and heartbeats and writes real attempt state. Use bounded per account concurrency, quota gates, retry backoff, cancellation, pause/resume, and explicit missed schedule handling. |
| Providers | Server side YouTube and Instagram publishing adapters, Drive and SupoClip import adapters, and Gemini generation. Use official platform APIs. Recover provider state using persisted upload/container IDs when possible. |

Data model: `SocialAccount`, `OAuthCredential`, `AccountGroup`, `AccountGroupMember`, `Clip`, `Post`, `PostTarget`, `Job`, `PublishAttempt`, `CaptionTemplate`, `Integration`, `AutomationRule`, `ImportCheckpoint`, `GeneratedMetadata`, `QuotaUsage`, and `AppSetting`. Use foreign keys, uniqueness on stable remote/source identifiers and logical operation keys, indexes for job claiming and due dates, immutable publication snapshots, and short transactions. Do not add a User model.

## Publication and integrations

- All publishing modes create independently tracked jobs per clip and destination. Store UTC timestamps and display in `Asia/Kolkata` by default. Distinguish acceptance, processing, and publication. Reconcile an uncertain provider outcome or move it to Needs Review; do not blindly repeat it. The local worker must be running and the host awake and online.
- Validate the Google and Meta OAuth flows, scopes, account eligibility, app access, refresh behavior, and current quotas at Phase 5. Verify YouTube resumable uploads and Instagram's supported upload path against real account configuration before any publication. Require explicit approval for a live test using one video and one account. Never expose the dashboard or media directory to the public internet.
- Use user initiated Drive selection with minimum suitable scope. Verify the running SupoClip deployment before choosing supported routes, controlled polling, or a watched folder. Persist checkpoints and deduplicate imports. An incomplete rule creates a durable Needs Review item. Automatic publication requires explicit activation of a rule specifying accounts, schedule, and metadata policy.
- The official Google Gen AI SDK sends user initiated suggestions and validates structured metadata against platform limits. Clip context is treated as untrusted data. Manual editing and publishing remain available during generation failures.

## Security boundaries

Use loopback binding plus strict Host and Origin validation on relevant routes; enforce CSRF protections and OAuth state, with PKCE where supported. Store OAuth credentials using authenticated encryption with distinct nonces and keep the key outside the repository. Validate media, constrain paths and redirects, apply import size limits, and prevent service requests from reaching unintended destinations. Keep secrets out of errors, logs, and browser responses. These mechanisms must be verified before enabling provider integrations. No auth or public deployment is part of the initial release.
