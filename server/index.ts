import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import type { OutputColumn } from '../src/types';

const project = process.env.GOOGLE_CLOUD_PROJECT;
const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';

if (!project) {
  console.error('[server] GOOGLE_CLOUD_PROJECT is not set. Configure it in .env.local.');
  process.exit(1);
}

// Vertex AI mode authenticates via Application Default Credentials.
// Run `gcloud auth application-default login` once on the host before starting.
const ai = new GoogleGenAI({
  vertexai: true,
  project,
  location,
});

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

function sendError(res: Response, err: unknown, fallback: string) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[server] ${fallback}:`, message);
  res.status(500).json({ error: message || fallback });
}

app.post('/api/improve-prompt', async (req: Request, res: Response) => {
  const { prompt, model } = req.body as { prompt?: string; model?: string };
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
    const response = await ai.models.generateContent({
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
  const { prompt, model } = req.body as { prompt?: string; model?: string };
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
    const response = await ai.models.generateContent({
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
  } = req.body as {
    row?: Record<string, string>;
    prompt?: string;
    inputColumns?: string[];
    outputColumns?: OutputColumn[];
    model?: string;
    enableWebSearch?: boolean;
  };

  if (!row || !prompt || !inputColumns || !outputColumns || !model) {
    return res.status(400).json({
      error: 'row, prompt, inputColumns, outputColumns, and model are required',
    });
  }

  const inputData = inputColumns
    .map((col) => `${col}: ${row[col]}`)
    .join('\n');

  const basePrompt = `
You are a web analysis agent. Your task is to analyze the following data and perform web searches if necessary to find the requested information.

Input Data:
${inputData}

Task:
${prompt}

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
    const response = await ai.models.generateContent({
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
  res.json({ ok: true, project, location });
});

// Optionally serve the built frontend in production.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(distDir));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

const PORT = parseInt(process.env.SERVER_PORT || '3001', 10);
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT} (project=${project}, location=${location})`);
});
