#!/usr/bin/env node
/**
 * Seed sample tickets into Chatwoot via API.
 * Requires: CHATWOOT_BASE_URL, CHATWOOT_API_TOKEN, CHATWOOT_ACCOUNT_ID, CHATWOOT_INBOX_ID
 *
 * Usage: node scripts/seed-tickets.js [limit]
 *   limit: max tickets to seed (default 10 for quick demo)
 */

const fs = require("fs");
const path = require("path");

const BASE_URL = process.env.CHATWOOT_BASE_URL || "http://localhost:3000";
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || "1";
const INBOX_ID = process.env.CHATWOOT_INBOX_ID || "";
const API_TOKEN = process.env.CHATWOOT_API_TOKEN || "";

function headers() {
  return {
    "Content-Type": "application/json",
    api_access_token: API_TOKEN,
  };
}

function parseTicket(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const match = raw.match(/^Tags: (.+)\n---\n\n([\s\S]+)/);
  const content = match ? match[2].trim() : raw.replace(/^Tags: .+\n---\n\n?/, "");
  return content;
}

async function createContact(email, name) {
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/contacts`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        inbox_id: parseInt(INBOX_ID, 10),
        email,
        name: name || email.split("@")[0],
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Create contact failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  const contactInbox = data.payload?.contact_inboxes?.[0] || data.contact_inboxes?.[0];
  const sourceId = contactInbox?.source_id || contactInbox?.id?.toString();
  return { contactId: data.payload?.id || data.id, sourceId };
}

async function createConversation(sourceId) {
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        source_id: sourceId,
        inbox_id: parseInt(INBOX_ID, 10),
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Create conversation failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  const convId = data.payload?.id || data.id;
  return convId;
}

async function addMessage(conversationId, content) {
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        content,
        message_type: "incoming",
        private: false,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Add message failed: ${res.status} ${err}`);
  }
}

async function main() {
  const limit = parseInt(process.argv[2] || "10", 10);

  if (!API_TOKEN || !INBOX_ID) {
    console.error("Missing CHATWOOT_API_TOKEN or CHATWOOT_INBOX_ID. Set in .env or environment.");
    console.error("Get INBOX_ID from Chatwoot Settings → Inboxes → your inbox ID in the URL.");
    process.exit(1);
  }

  const ticketsDir = path.join(__dirname, "..", "tickets");
  if (!fs.existsSync(ticketsDir)) {
    console.error("tickets/ directory not found");
    process.exit(1);
  }

  const files = fs.readdirSync(ticketsDir)
    .filter((f) => f.endsWith(".txt"))
    .slice(0, limit);

  console.log(`Seeding ${files.length} tickets...`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ticketId = file.replace("ticket_", "").replace(".txt", "");
    const content = parseTicket(path.join(ticketsDir, file));
    const email = `ticket-${ticketId}@demo.studyflash.local`;

    try {
      const { sourceId } = await createContact(email, `Ticket ${ticketId}`);
      const convId = await createConversation(sourceId);
      await addMessage(convId, content);
      console.log(`  [${i + 1}/${files.length}] ${file} → conversation ${convId}`);
    } catch (e) {
      console.error(`  [${i + 1}/${files.length}] ${file} failed:`, e.message);
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("Done. New conversations will trigger the AI pipeline webhook if configured.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
