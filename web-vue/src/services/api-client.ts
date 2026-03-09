/**
 * Shared HTTP client with timeout and error handling.
 * Used by all API services.
 *
 * Detects Capacitor environment to decide whether to use direct
 * API access (no CORS in native) or PHP proxy (browser CORS).
 */

/** Check if running inside Capacitor native shell */
export function isCapacitor(): boolean {
  return typeof (window as unknown as Record<string, unknown>).Capacitor !== 'undefined';
}

/** Fetch with timeout and abort controller */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return resp;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch JSON with timeout, returning typed result or error object.
 * Never throws — returns { error: string } on failure.
 */
export async function fetchJson<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T | { error: string }> {
  try {
    const resp = await fetchWithTimeout(url, options, timeoutMs);
    if (!resp.ok) {
      return { error: `HTTP ${resp.status}` };
    }
    return await resp.json() as T;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** Type guard to check if a response is an error */
export function isApiError(result: unknown): result is { error: string } {
  return typeof result === 'object' && result !== null && 'error' in result;
}
