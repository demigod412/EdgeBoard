/** Small JSON fetch for the free sources: 15 s timeout, 2 retries on 429/5xx with backoff. */
export async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15_000);
    try {
      const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "EdgeBoard/0.3 (+prediction app)", ...headers }, signal: ctl.signal, cache: "no-store" });
      if (r.status === 429 || r.status >= 500) {
        last = new Error(`HTTP ${r.status} from ${new URL(url).host}`);
        // Rate limits are per minute: honour Retry-After, else wait out the window instead of retrying in a second.
        const retryAfter = Number(r.headers.get("Retry-After")) || 0;
        await new Promise((res) => setTimeout(res, r.status === 429 ? Math.min(90_000, (retryAfter ? retryAfter + 1 : 62) * 1000) : 2000 * 2 ** attempt));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}: ${(await r.text()).slice(0, 160)}`);
      return (await r.json()) as T;
    } catch (e) { last = e; if (e instanceof Error && /HTTP 4\d\d/.test(e.message) && !/429/.test(e.message)) throw e; }
    finally { clearTimeout(t); }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const ymd = (d: Date) => d.toISOString().slice(0, 10);
