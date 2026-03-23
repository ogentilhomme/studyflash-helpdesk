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

app.get("/sidebar", (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>User Enrichment</title>
  <style>
    body { font-family: system-ui; padding: 16px; font-size: 14px; }
    h2 { font-size: 13px; margin: 16px 0 6px; text-transform: uppercase; color: #888; letter-spacing: 0.05em; }
    ul { padding-left: 18px; margin: 4px 0; }
    li { margin: 4px 0; }
    .error { color: #c00; }
    a { color: #0066cc; }
    .empty { color: #999; font-style: italic; }
    #email { font-size: 12px; color: #555; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div id="email">Waiting for contact...</div>
  <div id="content"></div>
  <script>
    function loadEnrichment(email) {
      document.getElementById('email').textContent = email;
      fetch('/enrich?email=' + encodeURIComponent(email))
        .then(r => r.json())
        .then(data => {
          let html = '';

          html += '<h2>Account</h2>';
          if (data.user) {
            html += '<p>Plan: <strong>' + (data.user.plan || 'N/A') + '</strong></p>';
            html += '<p>Signed up: ' + (data.user.signupDate || 'N/A') + '</p>';
          } else {
            html += '<p class="empty">Not found in DB</p>';
          }

          html += '<h2>Sentry</h2>';
          if (data.sentry.errors.length) {
            html += '<ul>';
            data.sentry.errors.forEach(e => {
              html += '<li><a href="' + (e.permalink || '#') + '" target="_blank">' + e.shortId + '</a>: ' + e.title + '</li>';
            });
            html += '</ul>';
          } else {
            html += '<p class="empty">No recent errors</p>';
          }

          html += '<h2>PostHog</h2>';
          if (data.posthog.recordingsLink) {
            html += '<p><a href="' + data.posthog.recordingsLink + '" target="_blank">View recordings</a></p>';
          } else {
            html += '<p class="empty">No recordings</p>';
          }

          document.getElementById('content').innerHTML = html;
        })
        .catch(e => {
          document.getElementById('content').innerHTML = '<p class="error">Error loading data</p>';
        });
    }

    // Chatwoot passes context via postMessage
    window.addEventListener('message', function(e) {
      var data = e.data;
      if (data && data.event === 'appContext' && data.data && data.data.contact && data.data.contact.email) {
        loadEnrichment(data.data.contact.email);
      }
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
