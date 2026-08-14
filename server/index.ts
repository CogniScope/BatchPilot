import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import type { OutputColumn } from '../src/types';

const app = express();
app.use(express.json({ limit: '10mb' }));

function stripJsonFences(text: string): string {
  let t = text.trim();
  if (t.startsWith('```json')) {
    t = t.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
  } else if (t.startsWith('```')) {
    t = t.replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
  }
  return t;
}

// Google API errors carry a string status such as "PERMISSION_DENIED" rather
// than an HTTP code. Passing that to res.status() sets an invalid status and
// throws when the headers are written, which escapes the route's catch block
// and takes the whole process (or serverless invocation) down, hiding the real
// error — so only accept a genuine HTTP code.
function toHttpStatus(err: unknown): number {
  const raw = (err as { status?: unknown; code?: unknown } | null)?.status
    ?? (err as { code?: unknown } | null)?.code;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(n) && n >= 400 && n <= 599 ? n : 500;
}

function sendError(res: Response, err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[server] ${fallback}:`, message);
  if (res.headersSent) return;
  res.status(toHttpStatus(err)).json({ error: message || fallback });
}

// The API key is supplied per-request by the browser; the server holds no
// credentials of its own.
function getClient(apiKey?: string): GoogleGenAI {
  if (!apiKey) {
    throw Object.assign(
      new Error('API key is required. Enter one in the API Key section of the sidebar.'),
      { status: 400 }
    );
  }
  // vertexai must be explicit: without it the SDK falls back to
  // GOOGLE_GENAI_USE_VERTEXAI from the environment and would route the key to
  // the Vertex endpoint, which rejects it.
  return new GoogleGenAI({ apiKey, vertexai: false });
}

app.post('/api/improve-prompt', async (req: Request, res: Response) => {
  const { prompt, model, apiKey } = req.body as {
    prompt?: string; model?: string; apiKey?: string;
  };
  if (!prompt || !model) {
    return res.status(400).json({ error: 'prompt and model are required' });
  }

  const fullPrompt = `
You are an expert prompt engineer. Your task is to improve the following instruction for a web analysis agent.
The agent will be given a row of data and this instruction, and it needs to extract specific information, possibly by searching the web.
Make the instruction clearer, more specific, and better suited for an LLM to follow.
Do not add any conversational filler, just return the improved instruction.

Original Instruction:
${prompt}
`;

  try {
    const client = getClient(apiKey);
    const response = await client.models.generateContent({
      model,
      contents: fullPrompt,
    });
    const text = response.text;
    if (!text) {
      return res.status(502).json({ error: 'No response from Gemini' });
    }
    res.json({ text: text.trim() });
  } catch (err) {
    sendError(res, err, 'improve-prompt failed');
  }
});

app.post('/api/generate-columns', async (req: Request, res: Response) => {
  const { prompt, model, apiKey } = req.body as {
    prompt?: string; model?: string; apiKey?: string;
  };
  if (!prompt || !model) {
    return res.status(400).json({ error: 'prompt and model are required' });
  }

  const fullPrompt = `
Based on the following agent instruction, suggest the appropriate output columns to extract the requested information.
Each column should have a short, snake_case 'name' and a brief 'description'.

Instruction:
${prompt}
`;

  try {
    const client = getClient(apiKey);
    const response = await client.models.generateContent({
      model,
      contents: fullPrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: 'Snake case column name' },
              description: { type: Type.STRING, description: 'Brief description of what to extract' },
            },
            required: ['name', 'description'],
          },
        },
      },
    });

    const raw = response.text;
    if (!raw) {
      return res.status(502).json({ error: 'No response from Gemini' });
    }
    const text = stripJsonFences(raw);

    let parsed: Array<{ name: string; description: string }>;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: `Failed to parse Gemini response as JSON. Response was: ${text.substring(0, 100)}...`,
      });
    }

    const columns: OutputColumn[] = parsed.map((item, index) => ({
      id: `gen_${Date.now()}_${index}`,
      name: item.name,
      description: item.description,
      type: 'string',
    }));
    res.json({ columns });
  } catch (err) {
    sendError(res, err, 'generate-columns failed');
  }
});

app.post('/api/process-row', async (req: Request, res: Response) => {
  const {
    row,
    prompt,
    inputColumns,
    outputColumns,
    model,
    enableWebSearch,
    apiKey,
  } = req.body as {
    row?: Record<string, string>;
    prompt?: string;
    inputColumns?: string[];
    outputColumns?: OutputColumn[];
    model?: string;
    enableWebSearch?: boolean;
    apiKey?: string;
  };

  if (!row || !prompt || !inputColumns || !outputColumns || !model) {
    return res.status(400).json({
      error: 'row, prompt, inputColumns, outputColumns, and model are required',
    });
  }

  const inputData = inputColumns
    .map((col) => `${col}: ${row[col]}`)
    .join('\n');

  const fieldsList = outputColumns
    .map((col) => `- ${col.name}${col.description ? `: ${col.description}` : ''}`)
    .join('\n');

  const basePrompt = `
You are a web analysis agent. Your task is to analyze the following data and perform web searches if necessary to find the requested information.

Input Data:
${inputData}

Task:
${prompt}

Fields to extract:
${fieldsList}

Please provide the output in the requested JSON format.
`;

  const properties: Record<string, { type: Type; description: string }> = {};
  const required: string[] = [];

  outputColumns.forEach((col) => {
    let schemaType: Type = Type.STRING;
    if (col.type === 'number') schemaType = Type.NUMBER;
    else if (col.type === 'boolean') schemaType = Type.BOOLEAN;

    properties[col.name] = {
      type: schemaType,
      description: col.description || `The value for ${col.name}`,
    };
    required.push(col.name);
  });

  const isLegacyModel = !model.startsWith('gemini-3');

  let finalPrompt = basePrompt;
  if (isLegacyModel) {
    finalPrompt += `

CRITICAL INSTRUCTION:
You MUST return ONLY a raw, valid JSON object as your response. Do not include any conversational filler, and do NOT wrap the response in markdown blocks like \`\`\`json.
The JSON object must have exactly the following keys: ${required.join(', ')}.`;
  }

  const config: Record<string, unknown> = {};
  if (enableWebSearch) {
    config.tools = [{ googleSearch: {} }];
  }
  if (!isLegacyModel) {
    config.responseMimeType = 'application/json';
    config.responseSchema = {
      type: Type.OBJECT,
      properties,
      required,
    };
  }

  try {
    const client = getClient(apiKey);
    const response = await client.models.generateContent({
      model,
      contents: finalPrompt,
      config,
    });

    const raw = response.text;
    if (!raw) {
      return res.status(502).json({ error: 'No response from Gemini' });
    }
    const text = stripJsonFences(raw);

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: `Failed to parse Gemini response as JSON. Response was: ${text.substring(0, 100)}...`,
      });
    }
    res.json({ result });
  } catch (err) {
    sendError(res, err, 'process-row failed');
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// On Vercel the frontend is served from the CDN and this file is imported as a
// serverless function, so it must not serve static files or bind a port.
// Everywhere else (local dev, `npm start`, Render/Railway/Cloud Run) it runs as
// a normal long-lived server that also serves the built frontend.
if (!process.env.VERCEL) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distDir = path.resolve(__dirname, '..', 'dist');
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  const PORT = parseInt(process.env.SERVER_PORT || '3001', 10);
  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
}

export default app;
