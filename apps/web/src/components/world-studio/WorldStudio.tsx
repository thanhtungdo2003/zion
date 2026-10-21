'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Heightfield, WorldMapDoc } from '@zion/worldgen/editor';
import { loadMap } from '@/studio/world/map-store';
import { MapManager } from './MapManager';
import MapEditor from './MapEditor';
import s from './world-studio.module.css';

const mapParam = () => new URLSearchParams(window.location.search).get('map');

/**
 * World Studio: the map library, and one map open in the editor (?map=<id>, so a reload or the
 * browser's back button lands where you were).
 */
export default function WorldStudio() {
  const [openId, setOpenId] = useState<string | null>(() => mapParam());
  const [loaded, setLoaded] = useState<{ id: string; doc: WorldMapDoc; terrain: Heightfield } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pop = () => setOpenId(mapParam());
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (!openId) { setLoaded(null); return; }
    let cancelled = false;
    setError(null);
    loadMap(openId).then((m) => { if (!cancelled) setLoaded({ id: openId, ...m }); }).catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [openId]);

  const open = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('map', id); else url.searchParams.delete('map');
    window.history.pushState(null, '', url);
    setOpenId(id);
  }, []);

  if (!openId) return <MapManager onOpen={open} />;
  if (error) return <div className={s.manager}><div className={s.emptyState} style={{ alignSelf: 'center' }}><strong>{error}</strong><button className={s.btn} onClick={() => open(null)}>Về danh sách bản đồ</button></div></div>;
  if (!loaded || loaded.id !== openId) return <div className={s.manager}><div className={s.emptyState} style={{ alignSelf: 'center' }}>Đang mở bản đồ…</div></div>;
  return <MapEditor key={loaded.id} initial={loaded} onExit={() => open(null)} />;
}
