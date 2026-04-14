import { GoogleGenAI, Type } from "@google/genai";
import { OutputColumn } from "../types";

export async function improvePromptWithGemini(
  prompt: string,
  modelName: string = "gemini-3-flash-preview"
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const ai = new GoogleGenAI({ apiKey });

  const fullPrompt = `
You are an expert prompt engineer. Your task is to improve the following instruction for a web analysis agent.
The agent will be given a row of data and this instruction, and it needs to extract specific information, possibly by searching the web.
Make the instruction clearer, more specific, and better suited for an LLM to follow.
Do not add any conversational filler, just return the improved instruction.

Original Instruction:
${prompt}
`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: fullPrompt,
  });

  const text = response.text;
  if (!text) {
    throw new Error("No response from Gemini");
  }

  return text.trim();
}

export async function generateOutputColumnsFromPrompt(
  prompt: string,
  modelName: string = "gemini-3-flash-preview"
): Promise<OutputColumn[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const ai = new GoogleGenAI({ apiKey });

  const fullPrompt = `
Based on the following agent instruction, suggest the appropriate output columns to extract the requested information.
Each column should have a short, snake_case 'name' and a brief 'description'.

Instruction:
${prompt}
`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: fullPrompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: "Snake case column name" },
            description: { type: Type.STRING, description: "Brief description of what to extract" }
          },
          required: ["name", "description"]
        }
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("No response from Gemini");
  }

  try {
    const result = JSON.parse(text);
    return result.map((item: any, index: number) => ({
      id: `gen_${Date.now()}_${index}`,
      name: item.name,
      description: item.description
    }));
  } catch (e) {
    throw new Error("Failed to parse Gemini response as JSON");
  }
}

export async function processRowWithGemini(
  row: Record<string, string>,
  prompt: string,
  inputColumns: string[],
  outputColumns: OutputColumn[],
  modelName: string = "gemini-3-flash-preview"
): Promise<Record<string, string>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const ai = new GoogleGenAI({ apiKey });

  // Construct the input data string
  const inputData = inputColumns
    .map((col) => `${col}: ${row[col]}`)
    .join("\n");

  const fullPrompt = `
You are a web analysis agent. Your task is to analyze the following data and perform web searches if necessary to find the requested information.

Input Data:
${inputData}

Task:
${prompt}

Please provide the output in the requested JSON format.
`;

  const properties: Record<string, any> = {};
  const required: string[] = [];

  outputColumns.forEach((col) => {
    properties[col.name] = {
      type: Type.STRING,
      description: col.description || `The value for ${col.name}`,
    };
    required.push(col.name);
  });

  const response = await ai.models.generateContent({
    model: modelName,
    contents: fullPrompt,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties,
        required,
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("No response from Gemini");
  }

  try {
    const result = JSON.parse(text);
    return result;
  } catch (e) {
    throw new Error("Failed to parse Gemini response as JSON");
  }
}

