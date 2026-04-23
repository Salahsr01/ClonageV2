import { LLMError } from '../../utils/llm.js';

export interface TextLLM {
  complete(input: { systemPrompt: string; userPrompt: string; maxTokens?: number }): Promise<string>;
}

export class AnthropicTextLLM implements TextLLM {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-5-20250929') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(input: { systemPrompt: string; userPrompt: string; maxTokens?: number }): Promise<string> {
    const body = {
      model: this.model,
      max_tokens: input.maxTokens ?? 4000,
      system: input.systemPrompt,
      messages: [{ role: 'user', content: input.userPrompt }],
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = (await res.text()).substring(0, 500);
      throw new LLMError('anthropic-text', `HTTP ${res.status}`, { status: res.status, detail });
    }
    const data = (await res.json()) as any;
    const text: string = data.content?.[0]?.text || '';
    if (!text) throw new LLMError('anthropic-text', 'empty response');
    return text;
  }
}

export class FakeTextLLM implements TextLLM {
  private factory: (input: { systemPrompt: string; userPrompt: string }) => string;
  constructor(factory: (input: { systemPrompt: string; userPrompt: string }) => string) {
    this.factory = factory;
  }
  async complete(input: { systemPrompt: string; userPrompt: string }): Promise<string> {
    return this.factory(input);
  }
}

export function loadDefaultTextLLM(): TextLLM {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new LLMError(
      'anthropic-text',
      'ANTHROPIC_API_KEY not set — planning requires an LLM API key.',
    );
  }
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
  return new AnthropicTextLLM(key, model);
}
