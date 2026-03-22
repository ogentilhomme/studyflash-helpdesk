const AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN || "";
const ORG_SLUG = process.env.SENTRY_ORG_SLUG || "";
const PROJECT_SLUG = process.env.SENTRY_PROJECT_SLUG || "";

export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  level: string;
  lastSeen: string;
  permalink?: string;
  metadata?: { value?: string };
}

export async function fetchRecentErrors(email: string): Promise<SentryIssue[]> {
  if (!AUTH_TOKEN || !ORG_SLUG) return [];

  const query = `user.email:${email}`;
  const project = PROJECT_SLUG ? `&project=${encodeURIComponent(PROJECT_SLUG)}` : "";
  const url = `https://sentry.io/api/0/organizations/${ORG_SLUG}/issues/?query=${encodeURIComponent(query)}&limit=10&statsPeriod=14d${project}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as any[];
    return data.slice(0, 5).map((i) => ({
      id: i.id,
      shortId: i.shortId || i.id,
      title: i.title || i.metadata?.value || "Unknown",
      level: i.level || "error",
      lastSeen: i.lastSeen || "",
      permalink: i.permalink,
      metadata: i.metadata,
    }));
  } catch {
    return [];
  }
}
