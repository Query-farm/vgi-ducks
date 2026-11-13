/** Bounded, timeout-protected HTTP reads for eBird's public services. */
export class UpstreamError extends Error {}

export type Fetcher = (url: URL | string, options: RequestInit) => Promise<Response>;

export interface HttpOptions {
  token?: string;
  followRedirects?: boolean;
  fetcher?: Fetcher;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
}

export function retryDelay(value: string | null, attempt: number, now = Date.now()): number {
  if (value) {
    const seconds = Number(value);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
    if (Number.isFinite(delay)) return Math.max(0, delay);
  }
  return 500 * 2 ** attempt;
}

export function endpoint(env: string, fallback: string, path: string): URL {
  const base = process.env[env] || fallback;
  const url = new URL(`${base.replace(/\/+$/, "")}/${path}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${env} must be an HTTP(S) URL without credentials`);
  }
  return url;
}

async function boundedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > maxBytes) {
    await response.body?.cancel();
    throw new UpstreamError(`eBird response exceeds ${maxBytes} bytes`);
  }
  if (!response.body) throw new UpstreamError("eBird returned no response body");
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new UpstreamError(`eBird response exceeds ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } finally {
    reader.releaseLock();
  }
}

export async function getBytes(url: URL | string, options: HttpOptions = {}): Promise<Uint8Array> {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  for (let attempt = 0; attempt < 4; attempt++) {
    let delay: number;
    try {
      let requestUrl = new URL(url);
      let response: Response;
      for (let redirects = 0; ; redirects++) {
        response = await fetcher(requestUrl, {
          redirect: options.followRedirects ? "manual" : "error",
          signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
          headers: {
            "User-Agent": "QueryFarm-vgi-ducks/0.1.0",
            Accept: "application/json",
            ...(options.token && requestUrl.origin === new URL(url).origin ? { "X-eBirdApiToken": options.token } : {}),
          },
        });
        if (!options.followRedirects || ![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirects >= 4) throw new UpstreamError("eBird download redirect limit or missing location");
        const next = new URL(location, requestUrl);
        if (next.username || next.password || (next.protocol !== "https:" && next.origin !== requestUrl.origin))
          throw new UpstreamError("eBird download returned an unsafe redirect");
        requestUrl = next;
      }
      if (response.ok) return await boundedBytes(response, maxBytes);
      await response.body?.cancel();
      if ((response.status !== 429 && response.status < 500) || attempt === 3) {
        throw new UpstreamError(`eBird request failed with HTTP ${response.status} (${new URL(url).pathname})`);
      }
      delay = retryDelay(response.headers.get("Retry-After"), attempt);
      // Do not retry earlier than eBird requests; fail when that would exceed our wait budget.
      if (delay > 30_000) throw new UpstreamError(`eBird HTTP ${response.status}: retry after ${delay / 1000} seconds`);
    } catch (error) {
      if (error instanceof UpstreamError) throw error;
      if (attempt === 3) throw new UpstreamError("eBird request failed after 4 attempts (network or timeout)");
      delay = retryDelay(null, attempt);
    }
    await sleep(delay);
  }
  throw new UpstreamError("eBird request exhausted retries");
}

export async function getText(url: URL | string, options: HttpOptions = {}): Promise<string> {
  return new TextDecoder().decode(await getBytes(url, options));
}

export async function getJson(url: URL | string, options: HttpOptions = {}): Promise<unknown> {
  const text = await getText(url, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new UpstreamError("eBird returned invalid JSON");
  }
}
