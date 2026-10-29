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
  maxTokens: number;
  // Gemma 4 は思考トークンが本文を食う。思考を切る。
  reasoning: boolean;
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
    maxTokens: 400,
    reasoning: false,
    estimatedNeuronsPerPhoto: Math.round(LLAMA32_MEASURED),
  },
  {
    id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    variant: 'llama4',
    shape: 'chat-image',
    vision: true,
    inputNeuronsPerMillion: 24545,
    outputNeuronsPerMillion: 77273,
    maxTokens: 400,
    reasoning: false,
    // 23枚のライブ実測 904。入力単価比の見積もりより少ない。
    estimatedNeuronsPerPhoto: Math.round(904 / 23),
  },
  {
    id: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    variant: 'mistral31',
    shape: 'chat-image',
    vision: true,
    inputNeuronsPerMillion: 31876,
    outputNeuronsPerMillion: 50488,
    maxTokens: 400,
    reasoning: false,
    estimatedNeuronsPerPhoto: estimate(31876),
  },
  {
    id: '@cf/google/gemma-3-12b-it',
    variant: 'gemma3',
    shape: 'chat-image',
    vision: true,
    inputNeuronsPerMillion: 31371,
    outputNeuronsPerMillion: 50560,
    maxTokens: 400,
    reasoning: false,
    estimatedNeuronsPerPhoto: estimate(31371),
  },
  {
    id: '@cf/google/gemma-4-26b-a4b-it',
    variant: 'gemma4',
    shape: 'chat-image',
    vision: true,
    inputNeuronsPerMillion: 9091,
    outputNeuronsPerMillion: 27273,
    maxTokens: 1024,
    reasoning: true,
    // 思考を切っても余白は残す。失敗した実行は思考で400トークンを使い741ニューロンだった。
    estimatedNeuronsPerPhoto: 35,
  },
  {
    id: '@cf/moondream/moondream3.1-9B-A2B',
    variant: 'moondream',
    shape: 'chat-image',
    vision: true,
    inputNeuronsPerMillion: 27273,
    outputNeuronsPerMillion: 90909,
    maxTokens: 400,
    reasoning: false,
    estimatedNeuronsPerPhoto: estimate(27273),
  },
];

export interface SearchVariant {
  name: string;
  model: AiModelSpec;
  secondModel?: AiModelSpec;
  ladder: boolean;
  estimatedNeuronsFor23: number;
  provider: 'workers' | 'gemini' | 'fallback';
}

const GEMINI_FLASH: AiModelSpec = {
  id: 'gemini-3.5-flash',
  variant: 'gemini',
  shape: 'chat-image',
  vision: true,
  inputNeuronsPerMillion: 0,
  outputNeuronsPerMillion: 0,
  maxTokens: 512,
  reasoning: false,
  estimatedNeuronsPerPhoto: 0,
};

const GEMINI_LITE: AiModelSpec = {
  ...GEMINI_FLASH,
  id: 'gemini-3.5-flash-lite',
  variant: 'gemini-lite',
};

export const SEARCH_VARIANTS: readonly SearchVariant[] = [
  ...AI_MODELS.flatMap((model) => {
    const once = model.estimatedNeuronsPerPhoto * 23;
    return [
      { name: model.variant, model, ladder: false, estimatedNeuronsFor23: once, provider: 'workers' as const },
      { name: `${model.variant}-ladder`, model, ladder: true, estimatedNeuronsFor23: once, provider: 'workers' as const },
    ];
  }),
  {
    name: 'ensemble',
    model: AI_MODELS[1],
    secondModel: AI_MODELS[0],
    ladder: true,
    estimatedNeuronsFor23: 904 + 569,
    provider: 'workers',
  },
  { name: 'gemini', model: GEMINI_FLASH, ladder: false, estimatedNeuronsFor23: 0, provider: 'gemini' },
  { name: 'gemini-ladder', model: GEMINI_FLASH, ladder: true, estimatedNeuronsFor23: 0, provider: 'gemini' },
  { name: 'gemini-lite', model: GEMINI_LITE, ladder: false, estimatedNeuronsFor23: 0, provider: 'gemini' },
  { name: 'gemini-lite-ladder', model: GEMINI_LITE, ladder: true, estimatedNeuronsFor23: 0, provider: 'gemini' },
  {
    name: 'llama4-gemini-fallback',
    model: AI_MODELS[1],
    secondModel: GEMINI_LITE,
    ladder: true,
    estimatedNeuronsFor23: 904,
    provider: 'fallback',
  },
];

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
  model: AiModelSpec,
  instruction: string,
  userText: string,
  dataUrl: string,
): Record<string, unknown> {
  const messages = model.shape === 'chat-image'
    ? [
      { role: 'system', content: instruction },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ]
    : [
      { role: 'system', content: instruction },
      { role: 'user', content: userText },
    ];
  const body: Record<string, unknown> = {
    messages,
    max_tokens: model.maxTokens,
    temperature: 0,
  };
  if (model.shape === 'image-field') body.image = dataUrl;
  if (model.reasoning) {
    // Gemma 4 26B は思考を切っても thought チャネルが残る。
    // https://ai.google.dev/gemma/docs/capabilities/thinking
    // reasoning_effort=none は enable_thinking を false にする。
    // https://docs.vllm.ai/en/latest/features/reasoning_outputs/
    // 上限は max_completion_tokens。モデルページにこの項目がある。
    // https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/
    body.chat_template_kwargs = { enable_thinking: false };
    body.reasoning_effort = 'none';
    body.max_completion_tokens = model.maxTokens;
  }
  return body;
}
