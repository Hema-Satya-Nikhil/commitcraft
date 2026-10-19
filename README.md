# CommitCraft

CommitCraft will turn GitHub repository commit history into readable, deterministic release notes.

This repository is currently at **Milestone 1: project foundation**. The domain engine, GitHub integration, and production UI are intentionally not implemented yet.

## Requirements

- Node.js `22.14.0` (see `.nvmrc`)
- npm
- Docker for container verification

## Setup

```bash
npm ci
```

The committed `package-lock.json` is the source of truth for dependency installation. Dependencies are installed locally in the project; no global packages are required.

## Development

```bash
npm run dev
```

Vite serves the development placeholder at `http://localhost:5173`.

## Tests

The canonical offline test command is:

```bash
npm test
```

Tests do not call GitHub or require network access after dependencies have been installed.

## Production build

```bash
npm run build
```

The production assets are written to `dist/`.

## Docker

The container uses Nginx explicitly configured to listen on port `4173` internally. The host and container ports therefore match:

```bash
docker build -t commitcraft .
docker run --rm -p 4173:4173 commitcraft
```

Open `http://localhost:4173` after the container starts.

## Configuration and secrets

No environment variables are currently required. `.env.example` documents this and is included to make the policy explicit. Do not put GitHub tokens in `VITE_*` variables: Vite embeds those values into the browser bundle, making them public.

## Planned milestones

1. Foundation and reproducible build (current milestone)
2. Independent deterministic release-note domain engine
3. GitHub API integration with bounded pagination, Link-header detection, rate-limit handling, and cancellation
4. Responsive production UI
5. Hardening, accessibility, and release verification
