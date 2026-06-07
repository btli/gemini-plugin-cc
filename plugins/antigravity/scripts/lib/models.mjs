// Model IDs are agy display labels — the only form `agy --model` resolves.
// Anything else silently falls back to agy's own default (Flash Medium);
// the facade detects that via the propagated label in agy's log.
export const MODELS = Object.freeze({
  PRO_HIGH: "Gemini 3.1 Pro (High)",
  PRO_LOW: "Gemini 3.1 Pro (Low)",
  FLASH_HIGH: "Gemini 3.5 Flash (High)",
  FLASH_MEDIUM: "Gemini 3.5 Flash (Medium)",
  FLASH_LOW: "Gemini 3.5 Flash (Low)",
  SONNET: "Claude Sonnet 4.6 (Thinking)",
  OPUS: "Claude Opus 4.6 (Thinking)",
  GPT_OSS: "GPT-OSS 120B (Medium)"
});

export const DEFAULT_MODEL = MODELS.PRO_HIGH;

export const MODEL_ALIASES = new Map([
  ["pro", MODELS.PRO_HIGH],
  ["pro-high", MODELS.PRO_HIGH],
  ["pro-low", MODELS.PRO_LOW],
  ["flash", MODELS.FLASH_HIGH],
  ["flash-high", MODELS.FLASH_HIGH],
  ["flash-medium", MODELS.FLASH_MEDIUM],
  ["flash-low", MODELS.FLASH_LOW],
  ["sonnet", MODELS.SONNET],
  ["opus", MODELS.OPUS],
  ["gpt-oss", MODELS.GPT_OSS]
]);

export function resolveModel(input) {
  if (input == null) {
    return null;
  }
  const normalized = String(input).trim();
  if (!normalized) {
    return null;
  }
  return MODEL_ALIASES.get(normalized.toLowerCase()) ?? normalized;
}

export function suggestAlternatives(failedModelId) {
  const alternatives = [];
  for (const [alias, modelId] of MODEL_ALIASES) {
    if (modelId !== failedModelId) {
      alternatives.push(alias);
    }
  }
  if (alternatives.length === 0) {
    return [...MODEL_ALIASES.keys()];
  }
  return alternatives;
}
