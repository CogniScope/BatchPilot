# Open Source Prep — Design Spec
**Date:** 2026-05-18

## Overview

Prepare the Batch LLM Processor for public open-source release. Six focused changes: add a license, replace dead auth UI with a live auth-mode switch, update stale metadata, remove all AI Studio boilerplate, and make errors visible to users.

---

## Section 1 — MIT LICENSE

Add a `LICENSE` file at the repo root with standard MIT text, year 2025, author Barış Ülgen. No other files change.

---

## Section 2 — Auth Mode Switch

### Goal
Users without a GCP account can use a Google AI Studio API key. Users with GCP use Vertex AI via ADC. The choice is explicit, not implicit.

### UI (`src/App.tsx`)

Replace the current "Override Gemini API Key" sidebar block with a new **Auth Mode** section containing:

- A two-option toggle: **Vertex ADC** | **AI Studio Key**
- When **Vertex ADC** is selected:
  - API key input is hidden
  - Tooltip: *"Uses Google Cloud Application Default Credentials. Run `gcloud auth application-default login` once, then set `GOOGLE_CLOUD_PROJECT` in `.env.local`. Usage is billed to your GCP project."*
- When **AI Studio Key** is selected:
  - Password input appears (placeholder `AIzaSy…`)
  - Tooltip: *"Get a free API key at aistudio.google.com/apikey. No GCP account needed."*
- Both `authMode` (`"vertex" | "aistudio"`) and `apiKey` (string) persist in `localStorage`.
- Both are passed through to `improvePromptWithGemini`, `generateOutputColumnsFromPrompt`, and `processRowWithGemini`.

### Client (`src/lib/gemini.ts`)

Each of the three exported functions gains two new parameters: `authMode: "vertex" | "aistudio"` and `apiKey: string`. The existing `_customApiKey` parameter is removed and replaced by `apiKey`. Both new params are forwarded in the request body to every `/api/*` endpoint. `App.tsx` call sites update accordingly.

### Server (`server/index.ts`)

Per-request auth selection in a shared helper:

```
function getClient(authMode, apiKey):
  if authMode === "aistudio" and apiKey present → new GoogleGenAI({ apiKey })
  if authMode === "aistudio" and no apiKey      → throw 400 "API key required for AI Studio mode"
  else                                           → shared Vertex ADC client (ai)
```

- Remove the `process.exit(1)` on missing `GOOGLE_CLOUD_PROJECT` at startup. Instead, fail at request time with a clear message: *"GOOGLE_CLOUD_PROJECT is not set. Configure it in .env.local for Vertex AI mode."*
- The shared `ai` (Vertex ADC) instance is created at startup only when `GOOGLE_CLOUD_PROJECT` is present. If the env var is missing, `ai` is `null` and Vertex mode requests fail at request time with a clear error. This avoids passing `undefined` as the project to the SDK.

---

## Section 3 — package.json Description

Change `description` from:
> "A fast, client-side web application for running AI prompts against tabular data in bulk using Gemini models."

To:
> "A web application for running AI prompts against tabular data in bulk, powered by Gemini via Vertex AI or Google AI Studio."

---

## Section 4 — Remove AI Studio Boilerplate

Scan and update all tracked files:

| File | Change |
|------|--------|
| `index.html` | Title: `"My Google AI Studio App"` → `"Batch LLM Processor"` |
| `metadata.json` | Description: update to match new `package.json` description |
| `README.md` | Already clean — verify no lingering AI Studio URLs |
| `.env.example` | Already clean — verify |
| Source files | Already clean — verify |

---

## Section 5 — Network Error Messages (`src/lib/gemini.ts`)

In the `postJson` helper, catch `TypeError` (which is what `fetch` throws when the server is unreachable) and rewrite the message:

> *"Cannot connect to the API server. Make sure it's running (`npm run dev`)."*

All other errors pass through unchanged.

---

## Section 6 — Row Error Visibility (`src/App.tsx`)

When `task.status === "error"`, the output cells currently show the flat string `"ERROR"`. Change the first output column cell to render the actual `task.error` message, truncated to 80 characters with an ellipsis if longer (remaining cells show empty). If there are no output columns defined, this section is a no-op. Full message remains available on hover via the existing `title` attribute on the status badge.

---

## Files Changed

| File | Change |
|------|--------|
| `LICENSE` | New — MIT |
| `index.html` | Title boilerplate |
| `metadata.json` | Description boilerplate |
| `package.json` | Description |
| `src/App.tsx` | Auth mode switch UI, error cell rendering |
| `src/lib/gemini.ts` | Forward `authMode`/`apiKey`, network error message |
| `server/index.ts` | Per-request auth helper, remove startup exit |

---

## Out of Scope

- Contributing guidelines / Code of Conduct
- GitHub Actions CI
- Production deployment changes
- Any UI redesign beyond the auth section
