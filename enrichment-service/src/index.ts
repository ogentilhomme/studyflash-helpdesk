import express from "express";
import { fetchRecentErrors } from "./sentry";
import {
  getSessionRecordingsLink,
  fetchSessionRecordings,
} from "./posthog";
import { fetchUserInfo } from "./postgres";

const app = express();
const PORT = process.env.PORT || 3200;

app.use(express.json());

interface EnrichmentResponse {
  email: string;
  sentry: { errors: Awaited<ReturnType<typeof fetchRecentErrors>> };
  posthog: {
    recordingsLink: string | null;
    recordings: Awaited<ReturnType<typeof fetchSessionRecordings>>;
  };
  user: Awaited<ReturnType<typeof fetchUserInfo>>;
}

app.get("/enrich", async (req, res) => {
  const email = req.query.email as string;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Missing or invalid email parameter" });
  }

  const [sentryErrors, recordingsLink, recordings, userInfo] = await Promise.all([
    fetchRecentErrors(email),
    getSessionRecordingsLink(email),
    fetchSessionRecordings(email),
    fetchUserInfo(email),
  ]);

  const payload: EnrichmentResponse = {
    email,
    sentry: { errors: sentryErrors },
    posthog: { recordingsLink, recordings },
    user: userInfo,
  };

  res.json(payload);
});

app.get("/sidebar", (req, res) => {
  const email = req.query.email as string;
  if (!email) {
    return res.status(400).send("Missing email parameter");
  }
  const enrichUrl = `${req.protocol}://${req.get("host")}/enrich?email=${encodeURIComponent(email)}`;
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>User Enrichment - ${email}</title>
  <style>
    body { font-family: system-ui; padding: 16px; max-width: 600px; margin: 0 auto; }
    h2 { font-size: 16px; margin-top: 20px; }
    ul { padding-left: 20px; }
    .error { color: #c00; }
    a { color: #0066cc; }
    .empty { color: #666; font-style: italic; }
  </style>
</head>
<body>
  <h1>User Enrichment</h1>
  <p><strong>Email:</strong> ${email}</p>
  <div id="content">Loading...</div>
  <script>
    fetch('${enrichUrl}')
      .then(r => r.json())
      .then(data => {
        let html = '';
        html += '<h2>Sentry Errors</h2>';
        if (data.sentry.errors.length) {
          html += '<ul>';
          data.sentry.errors.forEach(e => {
            html += '<li><a href="' + (e.permalink || '#') + '" target="_blank">' + e.shortId + '</a>: ' + e.title + ' (' + e.lastSeen + ')</li>';
          });
          html += '</ul>';
        } else html += '<p class="empty">No recent errors</p>';
        html += '<h2>PostHog</h2>';
        if (data.posthog.recordingsLink) {
          html += '<p><a href="' + data.posthog.recordingsLink + '" target="_blank">View session recordings</a></p>';
        }
        if (data.posthog.recordings.length) {
          html += '<ul>';
          data.posthog.recordings.forEach(r => {
            html += '<li>Recording ' + r.id + ' - ' + Math.round(r.duration) + 's</li>';
          });
          html += '</ul>';
        }
        html += '<h2>User Account</h2>';
        if (data.user) {
          html += '<p>Plan: ' + (data.user.plan || 'N/A') + '</p>';
          html += '<p>Signup: ' + (data.user.signupDate || 'N/A') + '</p>';
        } else html += '<p class="empty">User not found in internal DB</p>';
        document.getElementById('content').innerHTML = html;
      })
      .catch(e => {
        document.getElementById('content').innerHTML = '<p class="error">Error: ' + e.message + '</p>';
      });
  </script>
</body>
</html>
  `);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "enrichment-service" });
});

app.listen(PORT, () => {
  console.log(`Enrichment service listening on port ${PORT}`);
});
