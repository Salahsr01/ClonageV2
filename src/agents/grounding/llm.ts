import { LLMError } from '../../utils/llm.js';

/**
 * Pluggable Vision LLM interface.
 *
 * Real impl (`AnthropicVisionLLM`) hits api.anthropic.com with a multimodal
 * payload. Test impl (`FakeVisionLLM`) returns canned JSON from a factory.
 *
 * The contract is string-in / string-out (expected JSON). Validation against
 * the zod schema happens in the orchestrator (index.ts).
 */
export interface VisionLLM {
  describe(input: VisionInput): Promise<string>;
}

export interface VisionInput {
  systemPrompt: string;
  userPrompt: string;
  imagePath?: string;
  imageBase64?: string;
  imageMediaType?: 'image/png' | 'image/jpeg' | 'image/webp';
  maxTokens?: number;
}

export class AnthropicVisionLLM implements VisionLLM {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-5-20250929') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async describe(input: VisionInput): Promise<string> {
    const content: any[] = [];
    if (input.imageBase64) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: input.imageMediaType || 'image/png',
          data: input.imageBase64,
        },
      });
    }
    content.push({ type: 'text', text: input.userPrompt });

    const body = {
      model: this.model,
      max_tokens: input.maxTokens || 2000,
      system: input.systemPrompt,
      messages: [{ role: 'user', content }],
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
      throw new LLMError('anthropic-vision', `HTTP ${res.status}`, {
        status: res.status,
        detail,
      });
    }
    const data = (await res.json()) as any;
    const text: string = data.content?.[0]?.text || '';
    if (!text) throw new LLMError('anthropic-vision', 'empty response');
    return text;
  }
}

/**
 * Returns JSON strings from a seeded factory keyed by the image path (or a
 * hash of the user prompt). Used by tests so the e2e pipeline doesn't need
 * an API key.
 */
export class FakeVisionLLM implements VisionLLM {
  private factory: (input: VisionInput) => string;

  constructor(factory: (input: VisionInput) => string) {
    this.factory = factory;
  }

  async describe(input: VisionInput): Promise<string> {
    return this.factory(input);
  }
}

/**
 * Load an ANTHROPIC_API_KEY from env and return an AnthropicVisionLLM, or
 * throw if unavailable. The grounding orchestrator catches and reports a
 * friendly error.
 */
export function loadDefaultVisionLLM(): VisionLLM {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new LLMError(
      'anthropic-vision',
      'ANTHROPIC_API_KEY not set — grounding requires a vision-capable API key.',
    );
  }
  const model = process.env.ANTHROPIC_VISION_MODEL || 'claude-sonnet-4-5-20250929';
  return new AnthropicVisionLLM(key, model);
}
