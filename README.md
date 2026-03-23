# Studyflash Helpdesk

Internal support platform for Studyflash. Ingests Outlook emails as tickets, enriches them with user context, and assists the team with triage and response drafts — built as an MVP for the Platform Engineer hiring challenge.

---

## What it does

1. **Receives** support emails from the shared Outlook inbox via IMAP — Chatwoot creates a ticket per thread.
2. **Enriches** each new ticket with user context: recent Sentry errors, PostHog session recordings, and account data from the internal Postgres database.
3. **Translates** the message to English (common analysis base) and **categorizes** it into one of four buckets: `bug-report`, `refund-request`, `product-question`, `other`.
4. **Drafts** a suggested response and posts it as an internal note — visible only to agents, not sent to the customer.
5. **Assigns** (or flags) the ticket: high-confidence categorizations auto-assign to the right team; low-confidence ones get a `needs-triage` label.
6. **Sends** agent replies back through Outlook SMTP, keeping full thread parity via standard `Message-ID` / `In-Reply-To` email headers.

---

## Architecture

```
┌──────────────────┐   IMAP/SMTP   ┌───────────────────────────┐
│  Outlook Inbox   │◀────────────▶│         Chatwoot           │
│ (support@...)    │               │  (tickets, agents, UI)     │
└──────────────────┘               └────────────┬──────────────┘
                                                │ webhook
                                                │ (conversation_created,
                                                │  message_created)
                                                ▼
                                   ┌────────────────────────────┐
                                   │       AI Pipeline          │
                                   │  1. fetch enrichment       │
                                   │  2. translate → English    │
                                   │  3. categorize             │
                                   │  4. draft response         │
                                   │  5. label + assign         │
                                   └────────────┬───────────────┘
                                                │ REST
                                                ▼
                                   ┌────────────────────────────┐
                                   │    Enrichment Service      │
                                   │  Sentry · PostHog · PG     │
                                   └────────────────────────────┘
```

**Services (all via Docker Compose):**

| Service | Port | Role |
|---|---|---|
| `chatwoot-web` | 3000 | Rails ticket UI + email channel |
| `chatwoot-worker` | — | Sidekiq background jobs |
| `postgres` | 5432 | Chatwoot database (pgvector) |
| `redis` | 6379 | Cache + job queue |
| `ai-pipeline` | 3100 | Webhook listener, Claude orchestration |
| `enrichment-service` | 3200 | Sentry / PostHog / Postgres REST API |

---

## AI Pipeline flow

When Chatwoot fires a webhook for a new conversation (or a new incoming message on an existing one), the pipeline runs the following sequence — **once per ticket, guarded by an `ai-processed` label**:

```
webhook received
      │
      ▼
already processed? ──yes──▶ skip
      │ no
      ▼
fetch enrichment (Sentry errors, PostHog recordings, account plan)
      │
      ├─── post as internal note in Chatwoot
      │
      ▼
detect language + translate to English  ◀── run in parallel
      │
      ▼
categorize (English text)
      │
      ▼
draft response
      │
      ├─── post draft as internal note: "[AI Draft - respond in user's language]"
      │
      ▼
add labels (category, high-confidence | needs-triage, ai-processed)
      │
      ▼
high confidence? ──yes──▶ auto-assign to matching agent
      │ no
      ▼
post "[Suggested assignee]" note for manual triage
```

Subsequent customer replies on the same conversation are **not re-processed** — the `ai-processed` guard short-circuits. This is intentional for an MVP: the context and initial draft are attached to the thread for the agent to work from.

---

## Key design decisions

### Enrichment via webhook, not Chatwoot's sidebar integration

Chatwoot ships a "Custom Application" sidebar feature that embeds an iframe for each conversation. The natural approach would be to point it at `http://enrichment-service:3200/sidebar` so agents can pull context on demand.

This doesn't work in a local setup. Chatwoot serves its UI over HTTP on localhost, but browsers enforce mixed-content rules: an iframe loaded from a Docker-internal `http://` URL inside any page counts as mixed content and gets blocked. Fixing this would require a valid TLS certificate and a public HTTPS endpoint — significant infrastructure overhead for an MVP.

Instead, enrichment is triggered automatically from the **webhook handler** the moment a new ticket arrives. The result is formatted as a markdown internal note and posted directly into the conversation. Agents see it immediately without any sidebar setup, and it requires no HTTPS.

The `/sidebar` HTML endpoint is still served by the enrichment service and can be wired up as a Chatwoot custom app in a production deployment with proper HTTPS.

### Language normalization

Studyflash receives tickets in many languages (Dutch, German, French, Spanish, Italian, and more). The team is not always fluent in the customer's language, and Claude needs consistent input to categorize reliably.

**All incoming ticket content is translated to English before it reaches the categorization step.** This translation is done by Claude Haiku and runs in parallel with language detection. The English text is the sole input for categorization — it acts as a common, lossless base across all languages.

The draft response is generated from the **original, untranslated message** combined with the detected language code. Claude is instructed to reply in the customer's language. This is a best-effort approach: for an MVP it covers the common case well, and agents can adjust the draft before sending if the language inference is off.

### Claude Haiku over Sonnet

The pipeline runs four sequential Claude calls per ticket (detect language, translate, categorize, draft). At the volume Studyflash handles, using Sonnet for all of these would multiply API costs significantly. Haiku is fast, cheap, and more than capable for structured classification and short-form generation tasks. Sonnet (or Opus) can be swapped in for any individual step if quality proves insufficient.

### Chatwoot over a custom ticket UI

Building a custom ticket UI from scratch — with threading, assignment, notifications, search, inbox management — would dominate the implementation time and produce an inferior result. Chatwoot is a mature, open-source, self-hostable support platform with a polished UI, a full REST API, and native Outlook (IMAP/SMTP) integration. It covers requirements 1, 2, and 5 out of the box and exposes exactly the webhook surface needed to hook in custom AI logic.

### Thread parity with Outlook

Chatwoot handles email threading by preserving `Message-ID` and `In-Reply-To` headers on all sent and received emails. A reply sent from Chatwoot arrives in the Outlook thread as a proper reply in the same chain. Conversely, a reply sent from Outlook arrives back in the same Chatwoot conversation. No custom synchronization logic is needed.

---

## Requirements coverage

| Requirement | How it's met |
|---|---|
| Web platform to view and respond to tickets | Chatwoot UI at `http://localhost:3000` |
| Assignable to individual team members | Chatwoot native assignment + AI auto-assign for high-confidence tickets |
| Enrichment (Sentry, PostHog, Postgres) | `enrichment-service` — called from webhook, result posted as internal note |
| AI categorization, draft, assignee suggestion | `ai-pipeline` — Claude Haiku via Anthropic SDK |
| Outlook thread parity (send + receive) | Chatwoot email channel with `Message-ID`/`In-Reply-To` header preservation |

---

## Setup

### Prerequisites

- Docker + Docker Compose
- An Anthropic API key
- (Optional) Sentry, PostHog, and internal Postgres credentials for enrichment

### 1. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in:

```bash
# Generate a Rails secret
openssl rand -hex 64
# → paste as SECRET_KEY_BASE
```

At minimum you need `SECRET_KEY_BASE` and `ANTHROPIC_API_KEY`. The enrichment integrations (Sentry, PostHog, internal DB) are optional — the pipeline degrades gracefully if they are not configured.

### 2. Start all services

```bash
docker compose up -d
```

### 3. Initialize Chatwoot (first run only)

```bash
docker compose run --rm chatwoot-web bundle exec rails db:chatwoot_prepare
```

### 4. Chatwoot first-run setup

Open `http://localhost:3000` and complete the onboarding (create an account).

Then configure the following:

#### Email inbox (Outlook)

**Settings → Inboxes → Add Inbox → Email**

| Field | Value |
|---|---|
| IMAP Host | `outlook.office365.com` |
| IMAP Port | `993` (SSL) |
| SMTP Host | `smtp.office365.com` |
| SMTP Port | `587` (STARTTLS) |
| Email | `support@studyflash.ch` |
| Password | App password or account password |

#### Webhook for AI pipeline

**Settings → Integrations → Webhooks → Add Webhook**

- URL: `http://ai-pipeline:3100/webhook`
  _(Use `http://host.docker.internal:3100/webhook` if Chatwoot is not in the same Docker network as the pipeline, or an ngrok HTTPS URL for external testing.)_
- Subscribe to: `conversation_created`, `message_created`

#### Labels

Create these labels in **Settings → Labels** before running the pipeline:

`bug-report` · `refund-request` · `product-question` · `other` · `needs-triage` · `high-confidence` · `ai-processed`

### 5. Seed sample tickets (optional)

Create an **API channel** inbox in Chatwoot (**Settings → Inboxes → Add Inbox → API**), then:

```bash
export CHATWOOT_API_TOKEN=<your-token>
export CHATWOOT_ACCOUNT_ID=1
export CHATWOOT_INBOX_ID=<your-api-inbox-id>
node scripts/seed-tickets.js 10   # seeds 10 tickets; omit the number for all 100
```

---

## Environment variables

| Variable | Description |
|---|---|
| `SECRET_KEY_BASE` | Chatwoot Rails secret — `openssl rand -hex 64` |
| `POSTGRES_PASSWORD` | Postgres password (default: `postgres`) |
| `REDIS_URL` | Redis connection string (default: `redis://redis:6379`) |
| `FRONTEND_URL` | Chatwoot base URL (default: `http://localhost:3000`) |
| `ANTHROPIC_API_KEY` | Claude API key |
| `CHATWOOT_API_TOKEN` | From Chatwoot → Profile → Access Token |
| `CHATWOOT_BASE_URL` | Chatwoot URL reachable from the pipeline container |
| `CHATWOOT_ACCOUNT_ID` | Account ID (usually `1`) |
| `CHATWOOT_INBOX_ID` | API inbox ID — only needed for the seed script |
| `ENRICHMENT_SERVICE_URL` | Internal URL for the enrichment service (default: `http://enrichment-service:3200`) |
| `SENTRY_AUTH_TOKEN` | Sentry personal auth token |
| `SENTRY_ORG_SLUG` | Sentry organization slug |
| `SENTRY_PROJECT_SLUG` | Sentry project slug (optional — searches all projects if omitted) |
| `POSTHOG_API_KEY` | PostHog personal API key |
| `POSTHOG_HOST` | PostHog instance URL (default: `https://app.posthog.com`) |
| `INTERNAL_DB_URL` | Postgres connection string for the Studyflash user database |

See `.env.example` for the full list with defaults.

---

## Enrichment API

The enrichment service exposes two endpoints:

- **`GET /enrich?email=user@example.com`** — JSON response with Sentry errors (last 14 days), PostHog recordings link, and account info (plan, signup date).
- **`GET /sidebar?email=user@example.com`** — Self-contained HTML panel, usable as a Chatwoot custom app sidebar in a production HTTPS deployment.
- **`GET /health`** — `{ status: "ok" }`

---

## Project structure

```
/
├── docker-compose.yml
├── .env.example
├── ai-pipeline/
│   └── src/
│       ├── index.ts        # Webhook listener + orchestration
│       ├── translate.ts    # Language detection + English translation
│       ├── categorize.ts   # Claude categorization (4 categories)
│       ├── draft.ts        # Draft response generation
│       └── chatwoot.ts     # Chatwoot REST API client
├── enrichment-service/
│   └── src/
│       ├── index.ts        # GET /enrich, /sidebar, /health
│       ├── sentry.ts       # Recent errors by user email
│       ├── posthog.ts      # Session recordings by user email
│       └── postgres.ts     # Account info from internal DB
├── chatwoot-config/
│   └── setup-notes.md      # Detailed Chatwoot configuration reference
├── scripts/
│   └── seed-tickets.js     # Import sample tickets via Chatwoot API
└── tickets/                # 100 anonymized sample support tickets
```

---

## Local development (without Docker)

```bash
# AI Pipeline
cd ai-pipeline && npm install && npm run dev

# Enrichment Service
cd enrichment-service && npm install && npm run dev
```

Both services use `ts-node-dev` for hot reload.

---

## Trade-offs and what was left out

- **Draft language**: Drafts attempt to match the customer's language via Claude's language instruction. This works well for common languages but is not guaranteed — it's a soft instruction, not a translation pipeline. A more robust approach would translate the draft explicitly after generating it in English.
- **Subsequent replies**: Only the first message in a thread triggers the full AI pipeline. Subsequent customer replies are skipped to avoid noise. In a next iteration, incoming replies could trigger a lightweight "draft only" pass (no enrichment re-fetch).
- **Enrichment sidebar**: The `/sidebar` HTML endpoint exists but is not wired into Chatwoot's UI in this local setup due to the HTTP/HTTPS constraint described above. In production, it would function as a Chatwoot custom app.
- **Auto-send**: Drafts are always posted as internal notes — never sent automatically. An agent reviews and sends. This is deliberate: AI-assisted drafts reduce effort without the risk of sending incorrect or off-policy replies.
