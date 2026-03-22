const BASE_URL = process.env.CHATWOOT_BASE_URL || "http://localhost:3000";
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || "1";
const API_TOKEN = process.env.CHATWOOT_API_TOKEN || "";

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    api_access_token: API_TOKEN,
  };
}

export async function getConversation(conversationId: number): Promise<{
  id: number;
  labels?: string[];
  messages?: Array<{ content: string; message_type: number }>;
}> {
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}`,
    { headers: headers() }
  );
  if (!res.ok) {
    throw new Error(`Chatwoot API error: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  const conv = data.payload || data;
  return {
    id: conv.id,
    labels: conv.labels || [],
    messages: conv.messages || [],
  };
}

export async function addLabels(
  conversationId: number,
  labels: string[]
): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}/labels`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ labels }),
    }
  );
  if (!res.ok) {
    throw new Error(`Chatwoot add labels error: ${res.status} ${await res.text()}`);
  }
}

export async function addMessage(
  conversationId: number,
  content: string,
  privateNote = false
): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        content,
        message_type: "outgoing",
        private: privateNote,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(`Chatwoot add message error: ${res.status} ${await res.text()}`);
  }
}

export async function assignConversation(
  conversationId: number,
  assigneeId: number
): Promise<void> {
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/conversations/${conversationId}/assignments`,
    {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ assignee_id: assigneeId }),
    }
  );
  if (!res.ok) {
    throw new Error(`Chatwoot assign error: ${res.status} ${await res.text()}`);
  }
}

export async function getAgents(): Promise<Array<{ id: number; name: string }>> {
  const res = await fetch(
    `${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}/agents`,
    { headers: headers() }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const payload = data.payload || data;
  const agents = Array.isArray(payload) ? payload : payload.agents || [];
  return agents.map((a: { id: number; name?: string; available_name?: string }) => ({
    id: a.id,
    name: a.name || a.available_name || "",
  }));
}
