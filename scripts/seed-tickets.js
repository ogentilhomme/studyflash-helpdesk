#!/usr/bin/env node
/**
 * Seed sample tickets into Chatwoot via API.
 * Requires: CHATWOOT_BASE_URL, CHATWOOT_API_TOKEN, CHATWOOT_ACCOUNT_ID, CHATWOOT_INBOX_ID
 *
 * Usage: node scripts/seed-tickets.js [limit]
 *   limit: max tickets to seed (default 10 for quick demo)
 *
 * Loads .env from project root if present.
 */

const fs = require("fs");
const path = require("path");

// Load .env from project root (no extra deps)
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
}

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

async function searchContactByEmail(email) {
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/contacts/search?q=${encodeURIComponent(email)}`,
    { headers: headers() }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const contacts = data.payload || [];
  return contacts.find((c) => (c.email || c.identifier || "").toLowerCase() === email.toLowerCase()) || null;
}

async function createContactInbox(contactId, inboxId, sourceId) {
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/contacts/${contactId}/contact_inboxes`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        inbox_id: parseInt(inboxId, 10),
        source_id: String(sourceId),
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Create contact inbox failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  const contactInbox = data.payload?.contact_inboxes?.[0] || data.payload || data;
  const sid = contactInbox?.source_id ?? contactInbox?.id?.toString() ?? sourceId;
  return String(sid);
}

async function createContact(email, name) {
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/contacts`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        inbox_id: parseInt(INBOX_ID, 10),
        identifier: email,
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
  if (process.env.DEBUG) console.error("Create contact response:", JSON.stringify(data, null, 2).slice(0, 800));
  const contact = Array.isArray(data.payload) ? data.payload[0] : data.payload || data;
  const contactInbox = contact?.contact_inboxes?.[0] || data.contact_inboxes?.[0];
  const sourceId = contactInbox?.source_id ?? contactInbox?.id?.toString();
  const contactId = contact?.id ?? data.payload?.id ?? data.id;
  if (!sourceId) {
    throw new Error(`Create contact succeeded but no source_id in response. Contact ID: ${contactId}. Response: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return { contactId, sourceId: String(sourceId) };
}

async function findOrCreateContact(email, name) {
  const existing = await searchContactByEmail(email);
  if (existing) {
    const inboxIdNum = parseInt(INBOX_ID, 10);
    const contactInbox = (existing.contact_inboxes || []).find(
      (ci) => ci.inbox?.id === inboxIdNum || ci.inbox_id === inboxIdNum
    );
    if (contactInbox) {
      const sourceId = contactInbox.source_id ?? contactInbox.id?.toString();
      if (sourceId) {
        if (process.env.DEBUG) console.error("Using existing contact:", existing.id);
        return { contactId: existing.id, sourceId: String(sourceId) };
      }
    }
    const sourceId = await createContactInbox(existing.id, INBOX_ID, email);
    if (process.env.DEBUG) console.error("Added existing contact to inbox:", existing.id);
    return { contactId: existing.id, sourceId };
  }
  return createContact(email, name);
}

async function createConversation(sourceId, contactId, initialMessage) {
  const payload = {
    source_id: String(sourceId),
    inbox_id: parseInt(INBOX_ID, 10),
  };
  if (contactId) payload.contact_id = contactId;
  if (initialMessage) payload.message = { content: initialMessage };
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    if (process.env.DEBUG) console.error("Create conversation request:", JSON.stringify(payload));
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

async function listInboxes() {
  if (!API_TOKEN) {
    console.error("Missing CHATWOOT_API_TOKEN. Set in .env or environment.");
    process.exit(1);
  }
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/inboxes`,
    { headers: headers() }
  );
  if (!res.ok) {
    console.error(`Failed to list inboxes: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const data = await res.json();
  const inboxes = data.payload || data;
  console.log(`\nAccount ID: ${ACCOUNT_ID}`);
  console.log(`Inboxes:\n`);
  if (!Array.isArray(inboxes) || inboxes.length === 0) {
    console.log("  No inboxes found. Create an API channel first: Settings → Inboxes → Add Inbox → API.");
    return;
  }
  for (const ib of inboxes) {
    console.log(`  ID: ${ib.id}  |  ${ib.name || "Unnamed"}  |  type: ${ib.channel_type || "?"}`);
  }
  console.log(`\nSet CHATWOOT_INBOX_ID to the ID of your API channel inbox (channel_type: api).`);
}

async function main() {
  if (process.argv[2] === "--list-inboxes") {
    await listInboxes();
    return;
  }

  const args = process.argv.slice(2).filter((a) => a !== "--debug");
  if (process.argv.includes("--debug")) process.env.DEBUG = "1";
  const limit = parseInt(args[0] || "10", 10);

  if (!API_TOKEN || !INBOX_ID) {
    console.error("Missing CHATWOOT_API_TOKEN or CHATWOOT_INBOX_ID. Set in .env or environment.");
    console.error("Run: node scripts/seed-tickets.js --list-inboxes  to see your inbox IDs.");
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
      const { sourceId, contactId } = await findOrCreateContact(email, `Ticket ${ticketId}`);
      const convId = await createConversation(sourceId, contactId, content);
      if (!convId) throw new Error("No conversation ID returned");
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
