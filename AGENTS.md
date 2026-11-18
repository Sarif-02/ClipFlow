<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## ClipFlow

- Read [the product specification](docs/PRODUCT_SPEC.md), [design system](docs/DESIGN_SYSTEM.md), [architecture](docs/ARCHITECTURE.md), and [implementation plan](docs/IMPLEMENTATION_PLAN.md) before extending the app. Follow the current user approved phase.
- Follow the ClipFlow design system for UI changes. If the optional `landing-page-design` skill is installed locally, consult it before changing UI. The ClipFlow tokens and dashboard requirements take precedence.
- Keep ClipFlow single user and bound to loopback by default. Use official provider APIs. Never expose tokens in browser code, logs, or tracked files.
- Use mock providers in automated verification. Any live test publication requires explicit user approval, starting with one video and one account.
- Update the implementation plan with validation and remaining gaps at each phase boundary.
- Keep manual uploads independent of clipping software. SupoClip, Google Drive, and watched folders are outside the release scope. The five step wizard saves local drafts and queues jobs only on final confirmation.
- Run media tests using their own fixtures, database, and storage. Never use the user's originals as test data.
- Keep drafts and local calendar plans separate from runnable jobs until explicit submission. Do not add Supabase, a cloud database, or app authentication. See [integration setup](docs/INTEGRATIONS.md) for the Phase 4–6 provider and worker setup.
- Treat uploaded media as working copies. Preserve text history and remove managed media only after all required destinations have provider-verified success, no active reference needs it, and the configured policy permits it.
- Use the saved Gemini credential server side. Send text only on a generation request, require explicit confirmation for video analysis, and validate suggestions before offering them for review. Do not switch models or turn on billing.
