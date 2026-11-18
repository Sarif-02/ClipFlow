export const freeGeminiModels = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite"] as const;
export const aiStyles = ["Engaging", "Professional", "Funny", "Educational", "Motivational", "Concise", "Custom"] as const;
export const inlineVideoBytes = 8 * 1024 * 1024;
export const inlineVideoSeconds = 60;
export const localDailyAiRequests = 40;

export function supportsClipGeneration(model: string | undefined) {
  return freeGeminiModels.some(item => item === model);
}
