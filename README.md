<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Batch LLM Processor

A fast web application for running AI prompts against tabular data in bulk using Gemini on Vertex AI.

The app is split into two processes:

- **Vite dev server** (port 3000) — serves the React UI.
- **Express API server** (port 3001) — calls Gemini via `@google/genai` in Vertex AI mode using Application Default Credentials. The browser never sees credentials.

## Run Locally

**Prerequisites:**
- Node.js
- `gcloud` CLI authenticated to a project that has the Vertex AI API enabled

1. Install dependencies:
   ```
   npm install
   ```

2. Authenticate Application Default Credentials (one-time):
   ```
   gcloud auth application-default login
   ```

3. Configure your project in `.env.local` (see `.env.example`):
   ```
   GOOGLE_CLOUD_PROJECT=your-gcp-project-id
   GOOGLE_CLOUD_LOCATION=global
   GOOGLE_GENAI_USE_VERTEXAI=True
   SERVER_PORT=3001
   ```

4. Run the app (boots the API server and the Vite UI together):
   ```
   npm run dev
   ```

   Open http://localhost:3000.

## How auth works

`server/index.ts` initializes the SDK with:

```ts
new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT,
  location: process.env.GOOGLE_CLOUD_LOCATION,
});
```

In Vertex AI mode the SDK obtains tokens through Application Default Credentials, so usage is billed to the configured GCP project. No `GEMINI_API_KEY` / AI Studio key is required or supported.

## Production

Build the static frontend, then run the Express server which serves `dist/` and exposes `/api/*`:

```
npm run build
npm start
```

The server reads `NODE_ENV=production` and serves the built UI from the same origin.
