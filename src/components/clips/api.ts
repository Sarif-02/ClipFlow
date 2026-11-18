export async function sendClipAction(path: string, method: string, body?: object) {
  const response = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error ?? "The operation failed. Try again.");
  }
}
