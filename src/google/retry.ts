/** Retry reads and explicitly idempotent writes after temporary Google failures. */
export async function googleFetch(
  url: string,
  init?: RequestInit,
  retrySafe = !init?.method || init.method === "GET" || init.method === "PUT",
): Promise<Response> {
  const attempts = retrySafe ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt + 1 === attempts) throw error;
      await pause(500 * 2 ** attempt);
      continue;
    }
    if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt + 1 === attempts) {
      return response;
    }
    const retryAfter = response.headers.get("retry-after");
    const seconds = retryAfter == null ? NaN : Number(retryAfter);
    const delay = Number.isFinite(seconds)
      ? seconds * 1000
      : retryAfter ? Date.parse(retryAfter) - Date.now() : 500 * 2 ** attempt;
    await response.body?.cancel();
    await pause(Math.min(5000, Math.max(0, Number.isFinite(delay) ? delay : 500 * 2 ** attempt)));
  }
  throw new Error("Google request exhausted retries");
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
