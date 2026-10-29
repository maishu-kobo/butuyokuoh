// 無料枠の Workers AI。料金は 2026-10-20 の料金ページ。
// https://developers.cloudflare.com/workers-ai/platform/pricing/
// 既定は llama-3.2。別モデルは CAPTURE_AI_MODEL か評価の --variant で選ぶ。

export type AiRequestShape = 'image-field' | 'chat-image';

export interface AiModelSpec {
  id: string;
  variant: string;
  shape: AiRequestShape;
  vision: boolean;
  inputNeuronsPerMillion: number;
  outputNeuronsPerMillion: number;
  // 23枚の llama-3.2 実測 569 ニューロンを、入力単価の比で伸ばした見積もり。
  estimatedNeuronsPerPhoto: number;
}

const LLAMA32_MEASURED = 569 / 23;

function estimate(inputPerMillion: number): number {
  return Math.round(LLAMA32_MEASURED * (inputPerMillion / 4410));
}

export const AI_MODELS: readonly AiModelSpec[] = [
  {
    id: '@cf/meta/llama-3.2-11b-vision-instruct',
    variant: 'llama32',
    shape: 'image-field',
    vision: true,
    inputNeuronsPerMillion: 4410,
    outputNeuronsPerMillion: 61493,
    estimatedNeuronsPerPhoto: Math.round(LLAMA32_MEASURED),
  },
  {
    id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    variant: 'llama4',
    shape: 'chat-image',
    vision: true,
    inputNeuronsPerMillion: 24545,
    outputNeuronsPerMillion: 77273,
    estimatedNeuronsPerPhoto: estimate(24545),
  },
  {
    id: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    variant: 'mistral31',
    shape: 'chat-image',
    vision: true,
    inputNeuronsPerMillion: 31876,
    outputNeuronsPerMillion: 50488,
    estimatedNeuronsPerPhoto: estimate(31876),
  },
  {
    id: '@cf/google/gemma-3-12b-it',
    variant: 'gemma3',
    shape: 'chat-image',
    vision: true,
    inputNeuronsPerMillion: 31371,
    outputNeuronsPerMillion: 50560,
    estimatedNeuronsPerPhoto: estimate(31371),
  },
  {
    id: '@cf/google/gemma-4-26b-a4b-it',
    variant: 'gemma4',
    shape: 'chat-image',
    vision: true,
    inputNeuronsPerMillion: 9091,
    outputNeuronsPerMillion: 27273,
    estimatedNeuronsPerPhoto: estimate(9091),
  },
  {
    id: '@cf/moondream/moondream3.1-9B-A2B',
    variant: 'moondream',
    shape: 'chat-image',
    vision: true,
    inputNeuronsPerMillion: 27273,
    outputNeuronsPerMillion: 90909,
    estimatedNeuronsPerPhoto: estimate(27273),
  },
];

export interface SearchVariant {
  name: string;
  model: AiModelSpec;
  ladder: boolean;
  estimatedNeuronsFor23: number;
}

export const SEARCH_VARIANTS: readonly SearchVariant[] = AI_MODELS.flatMap((model) => {
  const once = model.estimatedNeuronsPerPhoto * 23;
  return [
    { name: model.variant, model, ladder: false, estimatedNeuronsFor23: once },
    { name: `${model.variant}-ladder`, model, ladder: true, estimatedNeuronsFor23: once },
  ];
});

export function resolveAiModel(id: string | null | undefined): AiModelSpec {
  const trimmed = id?.trim() ?? '';
  return AI_MODELS.find((model) => model.id === trimmed || model.variant === trimmed) ?? AI_MODELS[0];
}

export function resolveSearchVariant(name: string | null | undefined): SearchVariant {
  const trimmed = name?.trim() ?? '';
  return SEARCH_VARIANTS.find((variant) => variant.name === trimmed) ?? SEARCH_VARIANTS[0];
}

export function modelIdFromEnv(env?: { CAPTURE_AI_MODEL?: string }): string {
  const source = (env ?? process.env) as { CAPTURE_AI_MODEL?: string };
  const raw = source.CAPTURE_AI_MODEL;
  if (typeof raw !== 'string' || !raw.trim()) return AI_MODELS[0].id;
  const known = AI_MODELS.find((model) => model.id === raw.trim() || model.variant === raw.trim());
  return known?.id ?? AI_MODELS[0].id;
}

export function estimateNeurons(model: AiModelSpec, promptTokens: number, completionTokens: number): number {
  return (promptTokens * model.inputNeuronsPerMillion + completionTokens * model.outputNeuronsPerMillion) / 1_000_000;
}

export function aiRequestBody(
  shape: AiRequestShape,
  instruction: string,
  userText: string,
  dataUrl: string,
): Record<string, unknown> {
  if (shape === 'chat-image') {
    return {
      messages: [
        { role: 'system', content: instruction },
        {
          role: 'user',
          content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      max_tokens: 400,
      temperature: 0,
    };
  }
  return {
    messages: [
      { role: 'system', content: instruction },
      { role: 'user', content: userText },
    ],
    image: dataUrl,
    max_tokens: 400,
    temperature: 0,
  };
}
