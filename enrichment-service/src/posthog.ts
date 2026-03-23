const API_KEY = process.env.POSTHOG_API_KEY || "";
const HOST = process.env.POSTHOG_HOST || "https://app.posthog.com";

/**
 * PostHog session recordings API.
 * Returns a link to filter recordings by person (email).
 * The PostHog API requires project_id or environment_id - we construct a dashboard link
 * that agents can use to find recordings for this user.
 */
export async function getSessionRecordingsLink(email: string): Promise<string | null> {
  if (!API_KEY || !HOST) return null;

  try {
    const projectRes = await fetch(`${HOST.replace(/\/$/, "")}/api/projects/`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!projectRes.ok) return null;

    const projects = (await projectRes.json()) as any;
    const projectId = projects?.results?.[0]?.id || projects?.[0]?.id;
    if (!projectId) return null;

    const recordingsUrl = `${HOST.replace(/\/$/, "")}/project/${projectId}/recordings?person_email=${encodeURIComponent(email)}`;
    return recordingsUrl;
  } catch {
    return null;
  }
}

/**
 * Attempt to fetch recent session recordings for a person by email.
 * PostHog identifies persons by distinct_id - email may be in person properties.
 */
export interface PostHogRecording {
  id: string;
  startTime: string;
  duration: number;
  distinctId: string;
}

export async function fetchSessionRecordings(email: string): Promise<PostHogRecording[]> {
  if (!API_KEY || !HOST) return [];

  try {
    const projectRes = await fetch(`${HOST.replace(/\/$/, "")}/api/projects/`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!projectRes.ok) return [];

    const projects = (await projectRes.json()) as any;
    const projectId = projects?.results?.[0]?.id || projects?.[0]?.id;
    if (!projectId) return [];

    const recordingsRes = await fetch(
      `${HOST.replace(/\/$/, "")}/api/projects/${projectId}/session_recordings/?limit=5&person_email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${API_KEY}` } }
    );
    if (!recordingsRes.ok) return [];

    const data = (await recordingsRes.json()) as any;
    const results = data?.results || data?.recordings || [];
    return results.slice(0, 5).map((r: any) => ({
      id: r.id,
      startTime: r.start_time || r.startTime || "",
      duration: r.recording_duration || r.duration || 0,
      distinctId: r.distinct_id || r.distinctId || "",
    }));
  } catch {
    return [];
  }
}
