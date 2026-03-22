# Seeding Sample Tickets for Demo

The `tickets/` folder contains 100 sample tickets in the format:
```
Tags: tag1, tag2, tag3
---
<content>
```

## Option 1: Import via Chatwoot Email Channel

1. Set up the email channel in Chatwoot (IMAP/SMTP) per `chatwoot-config/setup-notes.md`
2. Use a script or tool to send the ticket content as emails to your support inbox
3. Each email will be ingested and trigger the AI pipeline

## Option 2: Import via Chatwoot API

Use the Chatwoot API to create conversations and messages programmatically:

```bash
# Create a contact and conversation for each ticket
# POST /api/v1/accounts/{account_id}/contacts
# POST /api/v1/accounts/{account_id}/conversations
# POST /api/v1/accounts/{account_id}/conversations/{id}/messages
```

## Option 3: Node.js Seed Script

Run the seed script (requires CHATWOOT_API_TOKEN and CHATWOOT_BASE_URL):

```bash
cd scripts && node seed-tickets.js
```

The script reads from `tickets/*.txt` and creates conversations with the first message.
Each new conversation will trigger the webhook → AI pipeline (if configured).
