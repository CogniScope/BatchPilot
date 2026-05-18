# BatchPilot

Run AI prompts against tabular CSV data in bulk using Gemini. Upload a CSV, define an agent instruction and output columns, and process hundreds of rows in parallel — results appear live in the table.

## Features

- **Bulk processing** — up to 25 concurrent Gemini calls with live status per row
- **Google Web Search** — optionally ground each call with real-time search results
- **Structured output** — define typed output columns; Gemini returns validated JSON
- **AI-assisted setup** — auto-generate output columns and improve prompts with one click
- **Dual auth** — use a free Google AI Studio API key or your own GCP project via Vertex AI ADC

## Architecture

The app runs as two processes:

- **Vite dev server** (port 3000) — React UI
- **Express API server** (port 3001) — proxies all Gemini calls server-side so credentials never reach the browser

## Getting Started

**Prerequisites:** Node.js 18+

```bash
npm install
```

Then pick an auth mode:

---

### Option A — Google AI Studio (easiest, no GCP needed)

1. Get a free API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Start the app:
   ```bash
   npm run dev
   ```
3. Open [http://localhost:3000](http://localhost:3000), select **AI Studio Key** in the sidebar, and paste your key.

No `.env.local` configuration needed for this path.

---

### Option B — Vertex AI via Application Default Credentials

Calls are billed to your GCP project. Requires the [Vertex AI API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com) to be enabled.

1. Authenticate once:
   ```bash
   gcloud auth application-default login
   ```

2. Create `.env.local` in the project root (see `.env.example`):
   ```
   GOOGLE_CLOUD_PROJECT=your-gcp-project-id
   GOOGLE_CLOUD_LOCATION=global
   GOOGLE_GENAI_USE_VERTEXAI=True
   ```

3. Start the app:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) — **Vertex ADC** is selected by default in the sidebar.

---

## Production

Build the static frontend, then run the Express server (serves `dist/` and `/api/*` from the same origin):

```bash
npm run build
npm start
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both the API server and Vite UI (hot-reload) |
| `npm run dev:server` | API server only |
| `npm run dev:client` | Vite UI only |
| `npm run build` | Build the frontend for production |
| `npm start` | Run the production server (serves built UI + API) |
| `npm run lint` | TypeScript type check |

## License

MIT — see [LICENSE](LICENSE).
