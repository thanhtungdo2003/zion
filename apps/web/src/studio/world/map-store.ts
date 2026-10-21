import { TerrainRaster } from './raster';
import { Heightfield, checkDoc, type WorldMapDoc, type WorldMapMeta } from '@zion/worldgen/editor';

/**
 * The World Studio's map library, in the browser's IndexedDB: map metadata (for the list), the
 * document (water, regions, match setups) and the terrain as binary arrays. A 4 km map is about
 * 5 MB of terrain, far beyond what localStorage can hold.
 */
const DB = 'zion-world-studio';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Trình duyệt không hỗ trợ IndexedDB.')); return; }
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of ['meta', 'docs', 'terrain']) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Không mở được kho bản đồ.'));
    req.onblocked = () => reject(new Error('Kho bản đồ đang bị một tab khác khóa — hãy đóng tab đó.'));
  });
}

let pending: Promise<IDBDatabase> | null = null;
const db = () => (pending ??= open().catch((err: unknown) => { pending = null; throw err; }));

function tx<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then((d) => new Promise<T | undefined>((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let result: T | undefined;
    const req = run(t);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error ?? new Error('Lỗi kho bản đồ.'));
    t.onabort = () => reject(t.error ?? new Error('Thao tác kho bản đồ bị hủy (có thể do hết dung lượng).'));
  }));
}

interface TerrainRecord { size: number; cell: number; heights: ArrayBuffer; surface: ArrayBuffer }

export async function listMaps(): Promise<WorldMapMeta[]> {
  return (await tx<WorldMapMeta[]>(['meta'], 'readonly', (t) => t.objectStore('meta').getAll())) ?? [];
}

export async function loadMap(id: string): Promise<{ doc: WorldMapDoc; terrain: Heightfield }> {
  const d = await db();
  const [doc, terrain] = await new Promise<[unknown, TerrainRecord | undefined]>((resolve, reject) => {
    const t = d.transaction(['docs', 'terrain'], 'readonly');
    const a = t.objectStore('docs').get(id), b = t.objectStore('terrain').get(id);
    t.oncomplete = () => resolve([a.result, b.result as TerrainRecord | undefined]);
    t.onerror = () => reject(t.error);
  });
  if (!doc || !terrain) throw new Error('Không tìm thấy bản đồ (có thể đã bị xóa).');
  const checked = checkDoc(doc);
  return { doc: checked, terrain: new Heightfield(terrain.size, terrain.cell, new Float32Array(terrain.heights), new Uint8Array(terrain.surface)) };
}

/** Writes all three records in one transaction: a map is never half saved. */
export async function saveMap(doc: WorldMapDoc, terrain: Heightfield): Promise<void> {
  const record: TerrainRecord = { size: terrain.size, cell: terrain.cell, heights: terrain.heights.slice().buffer, surface: terrain.surface.slice().buffer };
  await tx(['meta', 'docs', 'terrain'], 'readwrite', (t) => {
    t.objectStore('meta').put(doc.meta, doc.meta.id);
    t.objectStore('docs').put(doc, doc.meta.id);
    t.objectStore('terrain').put(record, doc.meta.id);
  });
}

/** Metadata only (rename, description): the terrain is left untouched. */
export async function saveMeta(doc: WorldMapDoc): Promise<void> {
  await tx(['meta', 'docs'], 'readwrite', (t) => {
    t.objectStore('meta').put(doc.meta, doc.meta.id);
    t.objectStore('docs').put(doc, doc.meta.id);
  });
}

export async function deleteMap(id: string): Promise<void> {
  await tx(['meta', 'docs', 'terrain'], 'readwrite', (t) => {
    for (const s of ['meta', 'docs', 'terrain']) t.objectStore(s).delete(id);
  });
}

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  try { const e = await navigator.storage?.estimate?.(); return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null; } catch { return null; }
}

/** A small hill-shaded preview for the map list. */
/** A small preview for the map list and the game's map picker: the studio raster (surfaces, climate tint, shading), scaled down. */
export function renderThumbnail(terrain: Heightfield, seaLevel: number, px = 160, tint: readonly number[] = [1, 1, 1]): string {
  const raster = new TerrainRaster(terrain, seaLevel);
  raster.contours = false; raster.tint = tint; raster.update();
  const out = document.createElement('canvas');
  out.width = out.height = px;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(raster.canvas, 0, 0, px, px);
  return out.toDataURL('image/webp', .82);
}

/** The old flat-shaded preview (kept for reference). */
export function renderThumbnailPlain(terrain: Heightfield, seaLevel: number, px = 160): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(px, px), step = terrain.size / px;
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const x = (i + .5) * step, z = (j + .5) * step, h = terrain.heightAt(x, z);
    const shade = Math.max(.55, Math.min(1.3, 1 - (terrain.heightAt(x + step, z) - h + terrain.heightAt(x, z + step) - h) / step * .8));
    const k = (j * px + i) * 4;
    const c = h < seaLevel ? [22, 52, 66] : h < seaLevel + 2 ? [168, 158, 118] : h > seaLevel + 180 ? [128, 126, 118] : [80, 108, 70];
    img.data[k] = c[0]! * shade; img.data[k + 1] = c[1]! * shade; img.data[k + 2] = c[2]! * shade; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/webp', .8);
}
