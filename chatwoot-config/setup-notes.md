# Chatwoot Configuration for Studyflash Helpdesk

## 1. Email Channel (IMAP/SMTP for Outlook)

1. In Chatwoot: **Settings → Inboxes → Add Inbox → Email**
2. Configure **Inbound**:
   - IMAP Host: `outlook.office365.com`
   - IMAP Port: `993` (SSL)
   - Email: `support@studyflash.ch`
   - Password: [App password or account password]
3. Configure **Outbound**:
   - SMTP Host: `smtp.office365.com`
   - SMTP Port: `587` (STARTTLS)
   - Email: `support@studyflash.ch`
   - Password: [Same as IMAP]
4. **Important**: Chatwoot uses `Message-ID` and `In-Reply-To` headers for thread parity. Ensure these are preserved in your Outlook setup.

## 2. Webhook for AI Pipeline

1. **Settings → Integrations → Webhooks → Add Webhook**
2. **URL**: 
   - From same Docker network: `http://ai-pipeline:3100/webhook`
   - From host (e.g. ngrok): `https://your-ngrok-url.ngrok.io/webhook` (expose ai-pipeline port 3100)
3. **Subscriptions**: Select `conversation_created` and `message_created` (for new messages on existing conversations)
4. Save the webhook

The AI pipeline will receive POST requests when new conversations are created and process them for:
- Translation to English
- Categorization (bug report / refund request / product question / other)
- Assignee suggestion (high confidence → auto-assign; low → flag for triage)
- Draft response in the user's original language

## 3. Enrichment Sidebar Integration

Chatwoot supports **sidebar integrations** (custom iframe apps):

1. **Settings → Integrations → Applications** (or Custom Integrations)
2. Add a **Sidebar Application**:
   - Name: `User Enrichment`
   - URL: `http://enrichment-service:3200/sidebar?email={contact.email}` (Chatwoot may use different placeholder; check docs)
3. Or use the **Custom Attributes** approach: add a link in the contact/conversation sidebar that opens the enrichment panel

**Alternative (simpler MVP)**: Add a link in the conversation view that opens the enrichment API in a new tab:
- `GET /enrich?email=user@example.com` returns JSON
- Build a minimal HTML page at `/enrich?email=...` that renders the data for agents to view

## 4. Create Labels for Categories

Create these labels in **Settings → Labels** before the AI pipeline runs:
- `bug-report`
- `refund-request`
- `product-question`
- `other`
- `needs-triage` (for low confidence)
- `high-confidence` (for auto-assign ready)

## 5. Environment Variables (Chatwoot container)

Ensure `.env` includes:
- `FRONTEND_URL`: Your Chatwoot base URL
- `SECRET_KEY_BASE`: Generate with `rails secret`
- `POSTGRES_*`, `REDIS_URL`: For DB and cache

See `.env.example` in the repo root for the full list.
