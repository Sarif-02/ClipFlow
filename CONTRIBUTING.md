# Contributing to ClipFlow

Fork ClipFlow on GitHub, clone your fork, and install Node.js 24, npm, FFmpeg, and FFprobe. Create a focused branch from `main`, such as `fix/clip-import` or `feature/queue-filter`.

```sh
npm ci
npm run db:deploy
npm run dev
```

The launcher starts the web app and worker. Use a dedicated development checkout with its own SQLite database and media folder. For UI conventions, see the [design system](docs/DESIGN_SYSTEM.md). For route, worker, and data boundaries, see the [architecture](docs/ARCHITECTURE.md) and [AGENTS.md](AGENTS.md).

Keep changes focused. Match the existing TypeScript and accessibility conventions. Keep provider keys and OAuth tokens on the server. Preserve loopback operation, explicit publishing confirmation, and additive database migrations for existing users. Read the installed Next.js documentation before changing framework code.

## Checks

```sh
npm run lint
npm run typecheck
npm run build
npx playwright-core install chromium
npm test
```

On Linux add `--with-deps` to the browser installation command if system libraries are missing. The build must finish before the browser tests. Use generated media, separate test databases, and mocked providers. Live publication requires separate approval from the operator for the selected file and account. Never include a network credential or real account data in a fixture.

Use the bug report template for a reproducible problem or the feature template for a proposed change. Keep logs and screenshots free of credentials and private content. Use the [private reporting process](SECURITY.md) for security concerns.

Open a pull request against `main`. Describe the behavior change, how you tested it, and any migration or compatibility effects. Include synthetic screenshots for visible UI changes when helpful.
