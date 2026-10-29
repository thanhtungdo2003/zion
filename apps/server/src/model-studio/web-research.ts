/**
 * Online research for the agent: Wikipedia (English and Vietnamese) searched and the best
 * articles' relevant passages returned — how a school, a hospital or a factory is laid out, what
 * its stairs, floors and railings are made of — so the design rests on how such buildings are
 * really built. Results are short, cached, and fail soft (the agent goes on without them).
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

export async function webResearch(query: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const key = query.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.out;
  const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(query);
  const out = (await Promise.all([wiki('en', query, fetchImpl), vietnamese ? wiki('vi', query, fetchImpl) : Promise.resolve([])].map((p) => p.catch(() => [] as string[])))).flat().slice(0, 4);
  cache.set(key, { at: Date.now(), out });
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return out;
}
