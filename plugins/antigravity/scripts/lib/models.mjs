export const MODELS = Object.freeze({
  AUTO_3: "auto-gemini-3",
  AUTO_2_5: "auto-gemini-2.5",
  PRO_3: "gemini-3.1-pro-preview",
  FLASH_3: "gemini-3-flash-preview",
  PRO_2_5: "gemini-2.5-pro",
  FLASH_2_5: "gemini-2.5-flash",
  FLASH_LITE_2_5: "gemini-2.5-flash-lite"
});

export const DEFAULT_MODEL = MODELS.PRO_3;

export const MODEL_ALIASES = new Map([
  ["auto", MODELS.AUTO_3],
  ["auto-3", MODELS.AUTO_3],
  ["auto-2.5", MODELS.AUTO_2_5],
  ["pro", MODELS.PRO_3],
  ["flash", MODELS.FLASH_3],
  ["pro-3", MODELS.PRO_3],
  ["flash-3", MODELS.FLASH_3],
  ["pro-2.5", MODELS.PRO_2_5],
  ["flash-2.5", MODELS.FLASH_2_5],
  ["flash-lite", MODELS.FLASH_LITE_2_5]
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
