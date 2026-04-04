export const MODELS = Object.freeze({
  FLASH_3: "gemini-3-flash",
  PRO_3: "gemini-3.1-pro",
  FLASH_2_5: "gemini-2.5-flash",
  PRO_2_5: "gemini-2.5-pro",
  FLASH_LITE_2_5: "gemini-2.5-flash-lite"
});

export const DEFAULT_MODEL = MODELS.PRO_3;

export const MODEL_ALIASES = new Map([
  ["flash", MODELS.FLASH_3],
  ["pro", MODELS.PRO_3],
  ["flash-lite", MODELS.FLASH_LITE_2_5],
  ["flash-2.5", MODELS.FLASH_2_5],
  ["pro-2.5", MODELS.PRO_2_5],
  ["flash-3", MODELS.FLASH_3],
  ["pro-3", MODELS.PRO_3]
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
