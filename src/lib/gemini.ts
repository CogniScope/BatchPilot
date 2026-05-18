import { OutputColumn } from "../types";

// All Gemini calls are proxied through the local Express server, which
// authenticates to Vertex AI via Application Default Credentials. The
// _customApiKey parameter is kept for backwards compatibility with the
// existing UI but is no longer forwarded — server-side ADC is the only
// supported credential path.

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Cannot connect to the API server. Make sure it's running (npm run dev)."
    );
  }

  if (!res.ok) {
    let message = `Request to ${path} failed with status ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data.error === "string") message = data.error;
    } catch {
      // fall back to status text
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export async function improvePromptWithGemini(
  prompt: string,
  modelName: string = "gemini-3-flash-preview",
  _customApiKey?: string
): Promise<string> {
  const data = await postJson<{ text: string }>("/api/improve-prompt", {
    prompt,
    model: modelName,
  });
  return data.text;
}

export async function generateOutputColumnsFromPrompt(
  prompt: string,
  modelName: string = "gemini-3-flash-preview",
  _customApiKey?: string
): Promise<OutputColumn[]> {
  const data = await postJson<{ columns: OutputColumn[] }>(
    "/api/generate-columns",
    { prompt, model: modelName }
  );
  return data.columns;
}

export async function processRowWithGemini(
  row: Record<string, string>,
  prompt: string,
  inputColumns: string[],
  outputColumns: OutputColumn[],
  modelName: string = "gemini-3-flash-preview",
  enableWebSearch: boolean = true,
  _customApiKey?: string
): Promise<Record<string, string>> {
  const data = await postJson<{ result: Record<string, string> }>(
    "/api/process-row",
    {
      row,
      prompt,
      inputColumns,
      outputColumns,
      model: modelName,
      enableWebSearch,
    }
  );
  return data.result;
}
