# Studyflash Internal Helpdesk

Internal support platform that ingests Outlook emails into tickets, with AI triage, enrichment, and team assignment. Built for the Studyflash hiring challenge.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Outlook Email  │────▶│     Chatwoot     │────▶│   AI Pipeline   │
│  (IMAP/SMTP)    │     │  (ticketing UI)  │     │  (Claude API)   │
└─────────────────┘     └────────┬─────────┘     └────────┬────────┘
                                 │                        │
                                 │                        │ labels, draft,
                                 │                        │ assignee suggestion
                                 │                        ▼
                                 │                 ┌─────────────────┐
                                 │                 │ Chatwoot API    │
                                 │                 └─────────────────┘
                                 │
                                 ▼
                        ┌──────────────────┐
                        │ Enrichment       │◀─── Sentry, PostHog, Postgres
                        │ Service          │
                        └──────────────────┘
```

- **Chatwoot**: Ticket UI, email channel (IMAP/SMTP), assignment, threading
- **AI Pipeline**: Webhook → translate → categorize → draft response → push to Chatwoot
- **Enrichment**: REST API for user context (Sentry errors, PostHog recordings, user data)

## Quick Start

### 1. Clone and configure

```bash
cp .env.example .env
# Edit .env - fill in SECRET_KEY_BASE, ANTHROPIC_API_KEY, CHATWOOT_API_TOKEN, etc.
```

### 2. Generate Chatwoot secret

```bash
openssl rand -hex 64
# Paste into .env as SECRET_KEY_BASE
```

### 3. Start services

```bash
docker compose up -d
```

### 4. Initialize Chatwoot (first run only)

```bash
docker compose run --rm chatwoot-web bundle exec rails db:chatwoot_prepare
```

### 5. Configure Chatwoot

1. Open http://localhost:3000 and complete setup (create account, login)
2. Follow `chatwoot-config/setup-notes.md`:
   - Add Email inbox (IMAP/SMTP for Outlook)
   - Add Webhook → `http://ai-pipeline:3100/webhook` (or `http://host.docker.internal:3100/webhook` if webhook is external)
   - Create labels: `bug-report`, `refund-request`, `product-question`, `other`, `needs-triage`, `high-confidence`, `ai-processed`

### 6. Seed sample tickets (optional)

Create an **API channel** inbox in Chatwoot, then:

```bash
export CHATWOOT_INBOX_ID=<your-api-inbox-id>
node scripts/seed-tickets.js 10
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SECRET_KEY_BASE` | Chatwoot Rails secret (generate with `openssl rand -hex 64`) |
| `POSTGRES_PASSWORD` | Postgres password |
| `ANTHROPIC_API_KEY` | Claude API key for AI pipeline |
| `CHATWOOT_API_TOKEN` | From Chatwoot Profile → Access Token |
| `CHATWOOT_BASE_URL` | e.g. http://localhost:3000 |
| `CHATWOOT_ACCOUNT_ID` | Account ID (usually 1) |
| `CHATWOOT_INBOX_ID` | For seed script - API inbox ID |
| `SENTRY_AUTH_TOKEN` | Sentry API token (enrichment) |
| `SENTRY_ORG_SLUG` | Sentry org slug |
| `SENTRY_PROJECT_SLUG` | Sentry project slug |
| `POSTHOG_API_KEY` | PostHog personal API key (enrichment) |
| `POSTHOG_HOST` | https://app.posthog.com |
| `INTERNAL_DB_URL` | Postgres URL for user data (enrichment) |

See `.env.example` for the full list.

## Project Structure

```
/
├── docker-compose.yml      # All services
├── .env.example
├── README.md
├── ai-pipeline/            # Webhook + Claude (translate, categorize, draft)
│   ├── Dockerfile
│   └── src/
│       ├── index.ts        # Webhook listener
│       ├── translate.ts
│       ├── categorize.ts
│       └── draft.ts
├── enrichment-service/     # Sentry, PostHog, Postgres
│   ├── Dockerfile
│   └── src/
│       ├── index.ts        # GET /enrich?email=...
│       ├── sentry.ts
│       ├── posthog.ts
│       └── postgres.ts
├── chatwoot-config/
│   └── setup-notes.md
├── scripts/
│   ├── seed-tickets.js     # Import sample tickets via API
│   └── seed-tickets.md     # Alternative seeding options
└── tickets/                # 100 sample tickets for demo
```

## Enrichment API

- **GET /enrich?email=user@example.com** – JSON with Sentry errors, PostHog link, user plan/signup
- **GET /sidebar?email=user@example.com** – HTML panel for Chatwoot sidebar integration

## Development

Run services locally without Docker:

```bash
# AI Pipeline
cd ai-pipeline && npm install && npm run dev

# Enrichment Service
cd enrichment-service && npm install && npm run dev
```

## License

MIT
