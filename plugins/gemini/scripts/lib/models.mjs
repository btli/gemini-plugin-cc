export const MODEL_ALIASES = new Map([
  ["flash", "gemini-2.5-flash"],
  ["pro", "gemini-2.5-pro"],
  ["flash-lite", "gemini-2.5-flash-lite"],
  ["flash-3", "gemini-3-flash"],
  ["pro-3", "gemini-3.1-pro"]
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
