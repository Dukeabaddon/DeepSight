/**
 * DeepSight LLM Integration (Option B)
 * 
 * When configured via env vars, DeepSight can use an LLM directly
 * instead of relying on the AI assistant to do the work.
 * 
 * Supported providers:
 * - openai  (OpenAI / compatible APIs)
 * - gemini  (Google Gemini)
 * - ollama  (Local Ollama)
 */

import { LLMProviderSchema } from './schemas.js';

interface LLMConfig {
  provider: 'openai' | 'gemini' | 'ollama';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

function getLLMConfig(): LLMConfig | null {
  const provider = process.env.DEEPSIGHT_LLM_PROVIDER;
  if (!provider) return null;

  const parsed = LLMProviderSchema.safeParse(provider);
  if (!parsed.success) {
    console.warn(`[DeepSight] Invalid LLM provider: ${provider}. Supported: gemini, openai, ollama`);
    return null;
  }

  return {
    provider: parsed.data,
    apiKey: process.env.DEEPSIGHT_LLM_API_KEY,
    model: process.env.DEEPSIGHT_LLM_MODEL,
    baseUrl: process.env.DEEPSIGHT_LLM_BASE_URL,
  };
}

export function isLLMConfigured(): boolean {
  return getLLMConfig() !== null;
}

/**
 * Generate text using the configured LLM.
 * Returns the generated text, or null if Option B is not configured.
 */
export async function generateText(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const config = getLLMConfig();
  if (!config) return null;

  switch (config.provider) {
    case 'gemini':
      return generateGemini(config, systemPrompt, userPrompt);
    case 'openai':
      return generateOpenAI(config, systemPrompt, userPrompt);
    case 'ollama':
      return generateOllama(config, systemPrompt, userPrompt);
    default:
      return null;
  }
}

async function generateGemini(config: LLMConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(config.apiKey || '');
  const model = genAI.getGenerativeModel({
    model: config.model || 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });
  const result = await model.generateContent(userPrompt);
  return result.response.text();
}

async function generateOpenAI(config: LLMConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl,
  });
  const response = await client.chat.completions.create({
    model: config.model || 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return response.choices[0]?.message?.content || '';
}

async function generateOllama(config: LLMConfig, systemPrompt: string, userPrompt: string): Promise<string> {
  const baseUrl = config.baseUrl || 'http://localhost:11434';
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model || 'llama3.2',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
    }),
  });
  const data = await response.json();
  return data.message?.content || '';
}