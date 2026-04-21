import { GoogleGenAI, Type } from "@google/genai";
import { OutputColumn } from "../types";

function getAIClient(customApiKey?: string) {
  let envToUse: any = {};
  if (typeof process !== 'undefined' && process.env) {
    envToUse = process.env;
  } else if (typeof window !== 'undefined' && (window as any).process && (window as any).process.env) {
    envToUse = (window as any).process.env;
  }

  let apiKey = customApiKey || envToUse.GEMINI_API_KEY;
  if (!customApiKey && envToUse.API_KEY) {
    apiKey = envToUse.API_KEY;
  }
  
  if (!apiKey) {
    throw new Error("API Key is missing. Please select your API Key when prompted.");
  }
  return new GoogleGenAI({ apiKey });
}

export async function checkAndPromptAPIKey(): Promise<boolean> {
  try {
    // @ts-ignore
    if (window.aistudio && window.aistudio.hasSelectedApiKey) {
      // @ts-ignore
      const hasKey = await window.aistudio.hasSelectedApiKey();
      if (!hasKey) {
        // @ts-ignore
        await window.aistudio.openSelectKey();
      }
      return true;
    }
  } catch (e) {
    console.error("Failed to prompt API key", e);
  }
  return true; // Assume true if the platform doesn't support the dialog
}

export async function improvePromptWithGemini(
  prompt: string,
  modelName: string = "gemini-3-flash-preview",
  customApiKey?: string
): Promise<string> {
  if (!customApiKey) await checkAndPromptAPIKey();
  const ai = getAIClient(customApiKey);

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
      model: modelName,
      contents: fullPrompt,
    });

    let text = response.text;
    if (!text) {
      throw new Error("No response from Gemini");
    }

    return text.trim();
  } catch (err: any) {
    throw new Error(err.message || "Unknown error occurred while calling Gemini");
  }
}

export async function generateOutputColumnsFromPrompt(
  prompt: string,
  modelName: string = "gemini-3-flash-preview",
  customApiKey?: string
): Promise<OutputColumn[]> {
  if (!customApiKey) await checkAndPromptAPIKey();
  const ai = getAIClient(customApiKey);

  const fullPrompt = `
Based on the following agent instruction, suggest the appropriate output columns to extract the requested information.
Each column should have a short, snake_case 'name' and a brief 'description'.

Instruction:
${prompt}
`;

  try {
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

    let text = response.text;
    if (!text) {
      throw new Error("No response from Gemini");
    }

    // Robustly parse JSON even if surrounded by markdown code blocks
    text = text.trim();
    if (text.startsWith("```json")) {
      text = text.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
    } else if (text.startsWith("```")) {
      text = text.replace(/^```\n?/, "").replace(/\n?```$/, "").trim();
    }

    try {
      const result = JSON.parse(text);
      return result.map((item: any, index: number) => ({
        id: `gen_${Date.now()}_${index}`,
        name: item.name,
        description: item.description,
        type: 'string'
      }));
    } catch (e) {
      throw new Error("Failed to parse Gemini response as JSON. Response was: " + text.substring(0, 100) + "...");
    }
  } catch (err: any) {
    throw new Error(err.message || "Unknown error occurred while calling Gemini");
  }
}

export async function processRowWithGemini(
  row: Record<string, string>,
  prompt: string,
  inputColumns: string[],
  outputColumns: OutputColumn[],
  modelName: string = "gemini-3-flash-preview",
  enableWebSearch: boolean = true,
  customApiKey?: string
): Promise<Record<string, string>> {
  if (!customApiKey) await checkAndPromptAPIKey();
  const ai = getAIClient(customApiKey);

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
    let schemaType = Type.STRING;
    if (col.type === 'number') schemaType = Type.NUMBER;
    else if (col.type === 'boolean') schemaType = Type.BOOLEAN;

    properties[col.name] = {
      type: schemaType,
      description: col.description || `The value for ${col.name}`,
    };
    required.push(col.name);
  });

  const isLegacyModel = !modelName.startsWith('gemini-3');

  let finalPrompt = fullPrompt;
  if (isLegacyModel) {
    finalPrompt += `

CRITICAL INSTRUCTION:
You MUST return ONLY a raw, valid JSON object as your response. Do not include any conversational filler, and do NOT wrap the response in markdown blocks like \`\`\`json.
The JSON object must have exactly the following keys: ${required.join(", ")}.`;
  }

  const config: any = {};
  
  if (enableWebSearch) {
    config.tools = [{ googleSearch: {} }];
  }

  if (!isLegacyModel) {
    config.responseMimeType = "application/json";
    config.responseSchema = {
      type: Type.OBJECT,
      properties,
      required,
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: finalPrompt,
      config,
    });

    let text = response.text;
    if (!text) {
      throw new Error("No response from Gemini");
    }

    // Strip markdown code blocks if the legacy model still returns them
    text = text.trim();
    if (text.startsWith("```json")) {
      text = text.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
    } else if (text.startsWith("```")) {
      text = text.replace(/^```\n?/, "").replace(/\n?```$/, "").trim();
    }

    try {
      const result = JSON.parse(text);
      return result;
    } catch (e) {
      throw new Error("Failed to parse Gemini response as JSON. Response was: " + text.substring(0, 100) + "...");
    }
  } catch (err: any) {
    throw new Error(err.message || "Unknown error occurred while calling Gemini API");
  }
}

