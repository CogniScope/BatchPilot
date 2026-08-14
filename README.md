<img width="846" height="178" alt="batchpilot_logo" src="https://github.com/user-attachments/assets/25dff506-55c8-4465-901b-4084fc922e17" />

Run AI prompts against tabular CSV data in bulk using Gemini. Upload a CSV, define an agent instruction and output columns, and process hundreds of rows in parallel — results appear live in the table.

## Features

- **Bulk processing** — up to 25 concurrent Gemini calls with live status per row
- **Google Web Search** — optionally ground each call with real-time search results
- **Structured output** — define typed output columns; Gemini returns validated JSON
- **AI-assisted setup** — auto-generate output columns and improve prompts with one click
- **Bring your own key** — a free Google AI Studio API key is all you need; no GCP account, no server-side configuration

## Architecture

- **React UI** — served by Vite in development (port 3000), as static files in production
- **Express API server** (port 3001) — proxies all Gemini calls so the key is never sent to Google from the browser

In development these run as two processes with Vite proxying `/api/*` to Express. In production a single Express process serves both the built UI and the API.

## Getting Started

**Prerequisites:** Node.js 18+

1. Get a free API key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

2. Install and start:
   ```bash
   npm install
   npm run dev
   ```

3. Open [http://localhost:3000](http://localhost:3000) and paste your key into the **API Key** field in the sidebar. It's stored in your browser's local storage and sent with each request.

No environment configuration is required.

## Production

Build the static frontend, then run the Express server (serves `dist/` and `/api/*` from the same origin):

```bash
npm run build
npm start
```

### Deploying to Vercel

Import the repository at [vercel.com/new](https://vercel.com/new) and accept the auto-detected Vite settings. [vercel.json](vercel.json) routes `/api/*` to [api/index.ts](api/index.ts), which serves the same Express app as a serverless function. No environment variables are needed.

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
