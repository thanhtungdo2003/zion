import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Online research for the agent: Wikipedia (English and Vietnamese) and a web search (articles,
 * building standards, descriptions of real plans and sections), with the relevant passages of
 * the best pages found — how a school, a hospital or a factory is laid out, how big its stairs
 * are and what they are made of — so the design rests on how such buildings are really built.
 * Results are short, cached, and fail soft (the agent goes on without them).
 *
 * Pages are fetched only over https from public hosts (names that resolve to private, loopback
 * or link-local addresses are refused, also after a redirect), with a size and time limit.
 */
const UA = { 'user-agent': 'Zion-Model-Studio/1.0 (architecture research)' };
const cache = new Map<string, { at: number; out: string[] }>();

interface Search { query?: { search?: Array<{ title: string; snippet: string }> } }
interface Extract { query?: { pages?: Record<string, { title?: string; extract?: string }> } }

async function wiki(lang: 'en' | 'vi', query: string, fetchImpl: typeof fetch): Promise<string[]> {
  const base = `https://${lang}.wikipedia.org/w/api.php`;
  const s = await fetchImpl(`${base}?action=query&list=search&srlimit=3&format=json&origin=*&srsearch=${encodeURIComponent(query)}`, { headers: UA, signal: AbortSignal.timeout(12_000) });
  if (!s.ok) return [];
  const hits = ((await s.json()) as Search).query?.search ?? [];
  if (!hits.length) return [];
  const titles = hits.map((h) => h.title).join('|');
  const e = await fetchImpl(`${base}?action=query&prop=extracts&explaintext=1&exsectionformat=plain&exchars=6000&format=json&origin=*&titles=${encodeURIComponent(titles)}`, { headers: UA, signal: AbortSignal.timeout(12_000) });
  if (!e.ok) return [];
  const pages = Object.values(((await e.json()) as Extract).query?.pages ?? {});
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return pages.flatMap((p) => {
    if (!p.extract) return [];
    // The paragraphs that speak to the question, else the article's opening.
    const paras = p.extract.split(/\n+/).map((x) => x.trim()).filter((x) => x.length > 60);
    const scored = paras.map((x) => ({ x, s: words.filter((w) => x.toLowerCase().includes(w)).length })).sort((a, b) => b.s - a.s);
    const best = (scored[0]?.s ? scored.slice(0, 3).map((x) => x.x) : paras.slice(0, 2)).join(' ').slice(0, 1400);
    return best ? [`[Wikipedia ${lang}: ${p.title}] ${best}`] : [];
  });
}

type Lookup = (host: string) => Promise<Array<{ address: string }>>;
const defaultLookup: Lookup = (host) => dnsLookup(host, { all: true });

/** Whether an address is private, loopback, link-local or otherwise not on the public internet. */
export function privateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a = 0, b = 0] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224;
  }
  const s = ip.toLowerCase();
  return s === '::' || s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb');
}

/** A URL the server may fetch: https, a host name (not an address) that resolves only to public addresses. */
export async function publicUrl(raw: string, lookup: Lookup = defaultLookup): Promise<URL | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) || !host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(host)) return null;
  const addrs = await lookup(host).catch(() => []);
  return addrs.length && addrs.every((a) => !privateAddress(a.address)) ? u : null;
}

/** A page's readable text (scripts, styles and markup dropped), following at most two redirects, each checked. */
async function pageText(url: string, fetchImpl: typeof fetch, lookup: Lookup): Promise<string> {
  let target = url;
  for (let hop = 0; hop < 3; hop++) {
    const u = await publicUrl(target, lookup);
    if (!u) return '';
    const r = await fetchImpl(u.toString(), { headers: { ...UA, accept: 'text/html,text/plain' }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { target = new URL(r.headers.get('location')!, u).toString(); continue; }
    if (!r.ok || !/text\/(html|plain)/.test(r.headers.get('content-type') ?? '')) return '';
    const html = (await r.text()).slice(0, 1_500_000);
    return html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ');
  }
  return '';
}

/** The paragraphs of a text that speak to the question. */
function passages(text: string, query: string, chars: number): string {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const paras = text.split(/\n+/).map((x) => x.trim()).filter((x) => x.length > 60);
  const scored = paras.map((x) => ({ x, s: words.filter((w) => x.toLowerCase().includes(w)).length + (/\d+(\.\d+)?\s*(mm|cm|m)\b/.test(x) ? 1 : 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.slice(0, 4).map((x) => x.x).join(' ').slice(0, chars);
}

/**
 * A web search (DuckDuckGo's HTML results, no key needed): titles and snippets of the first hits,
 * and the relevant passages of the first pages that can be read.
 */
export async function webSearch(query: string, fetchImpl: typeof fetch = fetch, lookup: Lookup = defaultLookup): Promise<string[]> {
  const r = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: { ...UA, accept: 'text/html' }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) return [];
  const html = (await r.text()).slice(0, 800_000);
  const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  const hits: Array<{ url: string; title: string; snippet: string }> = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (let m = re.exec(html); m && hits.length < 6; m = re.exec(html)) {
    let url = m[1]!.replace(/&amp;/g, '&');
    const redirect = /[?&]uddg=([^&]+)/.exec(url);
    if (redirect) url = decodeURIComponent(redirect[1]!);
    if (url.startsWith('//')) url = `https:${url}`;
    hits.push({ url, title: strip(m[2]!), snippet: strip(m[3]!) });
  }
  const out = hits.map((h) => `[web: ${h.title}] ${h.snippet} (${h.url})`);
  // The first readable pages, their passages on the question.
  let read = 0;
  for (const h of hits) {
    if (read >= 2) break;
    const text = await pageText(h.url, fetchImpl, lookup).catch(() => '');
    const best = text ? passages(text, query, 1400) : '';
    if (best) { out.push(`[trang: ${h.title}] ${best}`); read++; }
  }
  return out;
}

export async function webResearch(query: string, fetchImpl: typeof fetch = fetch, lookup: Lookup = defaultLookup): Promise<string[]> {
  const key = query.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.out;
  const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(query);
  const [web, en, vi] = await Promise.all([webSearch(query, fetchImpl, lookup), wiki('en', query, fetchImpl), vietnamese ? wiki('vi', query, fetchImpl) : Promise.resolve([])].map((p) => p.catch(() => [] as string[])));
  // The pages read first (passages with measurements), then the search snippets and the encyclopedia.
  const out = [...web!.filter((x) => x.startsWith('[trang')), ...vi!, ...en!, ...web!.filter((x) => x.startsWith('[web'))].slice(0, 8);
  cache.set(key, { at: Date.now(), out });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return out;
}
