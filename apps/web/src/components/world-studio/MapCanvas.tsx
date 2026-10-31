'use client';

import { shapeBounds, shapeDistance, zonesInOrder, type EnvShape } from '@zion/shared';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { distanceToPolyline, floraGroup, obbCorners, pointInPolygon, type BattleConfig, type Heightfield, type Obb, type Vec2, type WorldMapDoc } from '@zion/worldgen/editor';
import type { TerrainRaster } from '@/studio/world/raster';
import { drawShape, isBrush, isDraw, sameSelection, type Layers, type Overlay, type Selection, type Tool } from './types';

export interface MapCanvasHandle { fit(): void; zoom(factor: number): void; centerOn(x: number, z: number, span?: number): void }
export interface HoverInfo { x: number; z: number; height: number; scale: number }

interface Props {
  terrain: Heightfield;
  raster: TerrainRaster;
  /** Bumped whenever the raster or the document changed (redraw). */
  version: number;
  doc: WorldMapDoc;
  gameplay: BattleConfig | undefined;
  overlay: Overlay;
  layers: Layers;
  tool: Tool;
  selection: Selection | null;
  /** The Chiến trường tab is open: the battlefield is drawn strongly and its items can be picked. */
  warfareEdit?: boolean;
  /** The Môi trường tab is open: climate zones are drawn (with their blend margin) and can be picked. */
  envEdit?: boolean;
  onBrush: (phase: 'start' | 'move' | 'end', x: number, z: number) => void;
  onPlace: (x: number, z: number) => void;
  onDraft: (points: Vec2[]) => void;
  onDraftFinish: () => void;
  onSelect: (sel: Selection | null) => void;
  onMove: (sel: Selection, x: number, z: number) => void;
  onHover: (info: HoverInfo | null) => void;
}

const CLASS_COLOR: Record<string, string> = { residential: '#d9c08a', commercial: '#e39a54', industrial: '#9aa4ab', military: '#8f9a6a' };
const PROP_COLOR: Record<string, string> = { sign: '#f2f2f2', trafficLight: '#e8c34a', quay: '#9c9a92', pier: '#8b7f6a', pile: '#7a3d2e', breakwater: '#6f6c66', crane: '#e0a530', container: '#b4523a', bollard: '#444', hedge: '#4c7a3e', crop: '#9aa64e', wall: '#a7a49c', tree: '#3f6b3a', bush: '#56804a', deadTree: '#6f6450', fence: '#a58a62', perimeter: '#b0a36e', lamp: '#ffd36a', vehicle: '#c35a4a', militaryVehicle: '#6c7a4a', clutter: '#9a8466', industrialClutter: '#8b8f93', militaryClutter: '#7d7a56', bench: '#9b8a6e', debris: '#7a7570' };
const ROAD_COLOR: Record<string, string> = { main: '#cfc6ae', secondary: '#b5ad98', alley: '#968f7f', connector: '#cfc6ae' };
const LOT_FILL: Record<string, string> = { yard: 'rgba(120,160,90,.18)', full: 'rgba(170,150,120,.22)', garden: 'rgba(90,170,80,.3)', orchard: 'rgba(70,140,60,.3)', farm: 'rgba(170,150,70,.3)', walled: 'rgba(150,150,150,.2)', overgrown: 'rgba(80,110,60,.32)', vacant: 'rgba(140,130,100,.15)', work: 'rgba(130,135,140,.22)' };
const ENV_ZONE_COLOR: Record<string, string> = { temperate: '#8fd18a', dusty: '#d8b47a', humid: '#7fc6c0', wet: '#6d8fb8', desert: '#f0c060', forest: '#4f9a52', industrial: '#a0a0a8' };
const LOOT_COLOR: Record<string, string> = { weapons: '#ff5a4a', ammo: '#ffb000', medical: '#5ad17a', armor: '#5ab0ff', food: '#d9d16a', tools: '#b58cff' };

/**
 * The 2D world view: the terrain raster under vector overlays (water, roads, districts, match
 * setup), with zoom at the cursor, pan, brush strokes, polygon drawing and direct editing.
 * Draws on demand (one frame per change), never on a loop.
 */
export const MapCanvas = forwardRef<MapCanvasHandle, Props>(function MapCanvas(props, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ cx: props.terrain.size / 2, cz: props.terrain.size / 2, scale: 0, w: 1, h: 1 });
  const live = useRef(props);
  live.current = props;
  const frame = useRef(0);
  const hover = useRef<{ x: number; z: number } | null>(null);
  const gesture = useRef<null | { type: 'pan'; sx: number; sy: number; cx: number; cz: number } | { type: 'brush' } | { type: 'drag'; sel: Selection; ox: number; oz: number; x: number; z: number; moved: boolean } | { type: 'draft-vertex'; index: number }>(null);
  const space = useRef(false);

  const toWorld = useCallback((px: number, py: number): Vec2 => {
    const v = view.current;
    return [v.cx + (px - v.w / 2) / v.scale, v.cz + (py - v.h / 2) / v.scale];
  }, []);

  const draw = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const p = live.current, v = view.current, dpr = window.devicePixelRatio || 1;
    const { terrain, doc, layers, overlay, selection, gameplay } = p;
    const s = v.scale, px = 1 / s;
    // The current view, for tooling that maps world positions to the screen.
    canvas.dataset.view = `${v.cx.toFixed(2)},${v.cz.toFixed(2)},${s.toFixed(5)}`;
    const x0 = v.cx - v.w / 2 / s, z0 = v.cz - v.h / 2 / s, x1 = v.cx + v.w / 2 / s, z1 = v.cz + v.h / 2 / s;
    const visible = (x: number, z: number, r: number) => x + r >= x0 && x - r <= x1 && z + r >= z0 && z - r <= z1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0d1012';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(s * dpr, 0, 0, s * dpr, (v.w / 2 - v.cx * s) * dpr, (v.h / 2 - v.cz * s) * dpr);
    ctx.imageSmoothingEnabled = true;
    const half = terrain.cell / 2;
    ctx.drawImage(p.raster.canvas, -half, -half, terrain.size + terrain.cell, terrain.size + terrain.cell);
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = px; ctx.strokeRect(0, 0, terrain.size, terrain.size);
    const path = (pts: readonly Vec2[], close: boolean) => { ctx.beginPath(); pts.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z))); if (close) ctx.closePath(); };
    const drag = gesture.current?.type === 'drag' ? gesture.current : null;
    const offsetOf = (sel: Selection): Vec2 => (drag && drag.moved && sameSelection(drag.sel, sel) ? [drag.x - drag.ox, drag.z - drag.oz] : [0, 0]);
    // Shapes being dragged by one vertex.
    const shapePoints = (type: string, id: string, pts: Vec2[]): Vec2[] => {
      const ds = drag?.sel;
      if (drag && drag.moved && ds?.kind === 'shape' && ds.shape === type && ds.id === id && ds.vertex !== undefined) return pts.map((q, i) => (i === ds.vertex ? [drag.x, drag.z] as Vec2 : q));
      return pts;
    };
    const isSel = (sel: Selection) => sameSelection(selection, sel) || (selection?.kind === 'shape' && sel.kind === 'shape' && selection.shape === sel.shape && selection.id === sel.id);
    const box = (b: Obb, [dx, dz]: Vec2) => { const c = obbCorners({ ...b, x: b.x + dx, z: b.z + dz }); path(c, true); };

    /* Water. */
    if (layers.water) {
      for (const lake of doc.water.lakes) {
        const pts = shapePoints('lake', lake.id, lake.polygon);
        path(pts, true); ctx.fillStyle = 'rgba(46,112,140,.82)'; ctx.fill();
        ctx.strokeStyle = isSel({ kind: 'shape', shape: 'lake', id: lake.id }) ? '#ffb000' : 'rgba(150,210,230,.7)'; ctx.lineWidth = 1.5 * px; ctx.stroke();
      }
      for (const river of doc.water.rivers) {
        const pts = shapePoints('river', river.id, river.points.map((q) => [q.x, q.z] as Vec2));
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(46,112,140,.9)';
        for (let i = 1; i < pts.length; i++) { ctx.lineWidth = Math.max(2 * px, (river.points[i - 1]!.width + river.points[i]!.width) / 2); ctx.beginPath(); ctx.moveTo(...pts[i - 1]!); ctx.lineTo(...pts[i]!); ctx.stroke(); }
        if (isSel({ kind: 'shape', shape: 'river', id: river.id })) { path(pts, false); ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 1.5 * px; ctx.stroke(); }
        // Flow arrow at the source.
        if (pts.length > 1) { const [a, b] = [pts[0]!, pts[1]!]; const ang = Math.atan2(b[1] - a[1], b[0] - a[0]); ctx.fillStyle = '#bfe6f2'; ctx.beginPath(); ctx.moveTo(a[0] + Math.cos(ang) * 10 * px, a[1] + Math.sin(ang) * 10 * px); ctx.lineTo(a[0] + Math.cos(ang + 2.5) * 6 * px, a[1] + Math.sin(ang + 2.5) * 6 * px); ctx.lineTo(a[0] + Math.cos(ang - 2.5) * 6 * px, a[1] + Math.sin(ang - 2.5) * 6 * px); ctx.fill(); }
      }
    }

    /* Imported reference layer (the live island's roads and building pads). */
    if (layers.base) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const r of doc.base.roads) { path(r.points, false); ctx.strokeStyle = r.paved ? 'rgba(206,198,176,.85)' : 'rgba(150,126,92,.85)'; ctx.lineWidth = Math.max(1.2 * px, r.width); ctx.stroke(); }
      ctx.fillStyle = 'rgba(214,190,140,.55)'; ctx.strokeStyle = 'rgba(240,220,170,.7)'; ctx.lineWidth = px;
      for (const st of doc.base.structures) if (visible(st.x, st.z, Math.max(st.hx, st.hz) * 1.5)) { box(st, [0, 0]); ctx.fill(); ctx.stroke(); }
    }

    /* Painted and generated trees, plants and rocks. */
    if (layers.props && s > .12) {
      const r = Math.max(1.2 * px, 1.6);
      for (const f of doc.flora) {
        if (!visible(f[1], f[2], 4)) continue;
        const g = floraGroup.get(f[0]);
        ctx.fillStyle = g === 'rock' ? '#7d7a74' : g === 'grass' ? '#7f9a55' : g === 'bush' ? '#4f7d40' : '#2f5a2c';
        ctx.beginPath(); ctx.arc(f[1], f[2], g === 'tree' ? r * 1.6 * f[4] : r * f[4], 0, 6.283); ctx.fill();
      }
    }

    /* Settlements: applied results, then the preview being reviewed. */
    const drawResult = (regionId: string, r: NonNullable<Overlay['preview']>['result'], preview: boolean) => {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const road of r.roads) { path(road.points, false); ctx.strokeStyle = preview ? 'rgba(255,190,80,.95)' : ROAD_COLOR[road.kind]!; ctx.lineWidth = Math.max(1.2 * px, road.width); ctx.stroke(); }
      if (s > .5) {
        ctx.strokeStyle = preview ? 'rgba(255,176,0,.35)' : 'rgba(120,200,180,.28)'; ctx.lineWidth = px;
        for (const lot of r.lots) if (visible(lot.obb.x, lot.obb.z, lot.obb.hx + lot.obb.hz)) {
          // Each parcel tinted by its use, so the jigsaw of plots reads at a glance.
          path(lot.polygon, true);
          if (!preview && lot.style) { ctx.fillStyle = LOT_FILL[lot.style] ?? 'transparent'; ctx.fill(); }
          ctx.stroke();
        }
      }
      if (layers.buildings) for (const b of r.buildings) {
        if (!visible(b.obb.x, b.obb.z, b.obb.hx + b.obb.hz)) continue;
        const sel: Selection = { kind: 'building', region: regionId, id: b.id };
        box(b.obb, offsetOf(sel)); ctx.fillStyle = CLASS_COLOR[b.cls]!; ctx.fill();
        ctx.strokeStyle = isSel(sel) ? '#ffb000' : b.manual ? '#ffffff' : 'rgba(20,20,20,.7)'; ctx.lineWidth = (isSel(sel) ? 2.5 : 1) * px; ctx.stroke();
        if (s > 1.2) { const [dx, dz] = offsetOf(sel); ctx.fillStyle = '#1a1a1a'; ctx.fillRect(b.door[0] + dx - .6, b.door[1] + dz - .6, 1.2, 1.2); }
      }
      if (layers.props && s > .35) for (const q of r.props) {
        if (!visible(q.x, q.z, 10)) continue;
        const sel: Selection = { kind: 'prop', region: regionId, id: q.id };
        const [dx, dz] = offsetOf(sel);
        ctx.fillStyle = PROP_COLOR[q.kind] ?? '#999';
        if (q.kind === 'tree' || q.kind === 'bush' || q.kind === 'deadTree') { ctx.beginPath(); ctx.arc(q.x + dx, q.z + dz, Math.max(1.5 * px, Math.max(q.obb.hx, q.obb.hz) * 1.6), 0, 6.283); ctx.fill(); }
        else { box(q.obb, [dx, dz]); ctx.fill(); }
        if (isSel(sel) || q.manual) { ctx.strokeStyle = isSel(sel) ? '#ffb000' : '#fff'; ctx.lineWidth = 2 * px; box(q.obb, [dx, dz]); ctx.stroke(); }
      }
    };
    if (layers.regions) for (const region of doc.regions) {
      const pts = shapePoints('region', region.id, region.polygon);
      const selected = isSel({ kind: 'shape', shape: 'region', id: region.id });
      path(pts, true); ctx.fillStyle = selected ? 'rgba(255,176,0,.06)' : 'rgba(255,255,255,.03)'; ctx.fill();
      if (region.result && overlay.preview?.region !== region.id) drawResult(region.id, region.result, false);
      path(pts, true); ctx.setLineDash([8 * px, 5 * px]); ctx.strokeStyle = selected ? '#ffb000' : 'rgba(255,255,255,.55)'; ctx.lineWidth = (selected ? 2 : 1.2) * px; ctx.stroke(); ctx.setLineDash([]);
    }
    if (overlay.preview) drawResult(overlay.preview.region, overlay.preview.result, true);

    /* Match setup. */
    if (layers.gameplay && gameplay) {
      const g = gameplay;
      for (const nz of g.noGoZones) {
        const pts = shapePoints('nogo', nz.id, nz.polygon);
        path(pts, true); ctx.fillStyle = nz.kind === 'no-go' ? 'rgba(255,59,48,.18)' : 'rgba(60,60,60,.45)'; ctx.fill();
        ctx.strokeStyle = isSel({ kind: 'shape', shape: 'nogo', id: nz.id }) ? '#ffb000' : 'rgba(255,90,80,.8)'; ctx.lineWidth = 1.5 * px; ctx.setLineDash([4 * px, 3 * px]); ctx.stroke(); ctx.setLineDash([]);
      }
      for (const sz of g.spawnZones) {
        const pts = shapePoints('spawnzone', sz.id, sz.polygon);
        path(pts, true); ctx.fillStyle = 'rgba(80,180,255,.12)'; ctx.fill(); ctx.strokeStyle = isSel({ kind: 'shape', shape: 'spawnzone', id: sz.id }) ? '#ffb000' : 'rgba(110,190,255,.8)'; ctx.lineWidth = 1.5 * px; ctx.stroke();
      }
      const circle = (x: number, z: number, r: number, stroke: string, width: number, dash?: number[]) => { ctx.beginPath(); ctx.arc(x, z, r, 0, 6.283); ctx.strokeStyle = stroke; ctx.lineWidth = width * px; ctx.setLineDash(dash?.map((d) => d * px) ?? []); ctx.stroke(); ctx.setLineDash([]); };
      const pa = g.playArea, [pdx, pdz] = offsetOf({ kind: 'play-area' });
      circle(pa.x + pdx, pa.z + pdz, pa.radius, isSel({ kind: 'play-area' }) ? '#ffb000' : 'rgba(80,170,255,.9)', 2.5);
      ctx.fillStyle = '#50aaff'; ctx.fillRect(pa.x + pdx - 4 * px, pa.z + pdz - 4 * px, 8 * px, 8 * px);
      overlay.zones?.slice(1).forEach((c, i) => circle(c.x, c.z, c.radius, i === overlay.zones!.length - 2 ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.5)', 1.5, [6, 4]));
      g.phases.forEach((ph, i) => { if (ph.center) { const sel: Selection = { kind: 'phase', index: i }; circle(ph.center[0], ph.center[1], ph.radius, isSel(sel) ? '#ffb000' : 'rgba(255,220,120,.8)', 1.2, [2, 3]); } });
      for (const h of g.hotspots) { const [dx, dz] = offsetOf({ kind: 'point', point: 'hotspot', id: h.id }); ctx.beginPath(); ctx.arc(h.x + dx, h.z + dz, h.radius, 0, 6.283); ctx.fillStyle = `rgba(255,70,50,${.06 + h.danger * .04})`; ctx.fill(); circle(h.x + dx, h.z + dz, h.radius, isSel({ kind: 'point', point: 'hotspot', id: h.id }) ? '#ffb000' : 'rgba(255,90,70,.9)', 1.5); }
      for (const a of g.loot.rareAreas) { const [dx, dz] = offsetOf({ kind: 'point', point: 'rare', id: a.id }); circle(a.x + dx, a.z + dz, a.radius, isSel({ kind: 'point', point: 'rare', id: a.id }) ? '#ffb000' : 'rgba(190,130,255,.95)', 1.5, [3, 2]); }
      if (s > .25) for (const l of g.loot.points) {
        if (!visible(l.x, l.z, 4)) continue;
        const sel: Selection = { kind: 'point', point: 'loot', id: l.id }, [dx, dz] = offsetOf(sel), r = (1.5 + l.tier) * px;
        ctx.fillStyle = LOOT_COLOR[l.category]!; ctx.fillRect(l.x + dx - r, l.z + dz - r, r * 2, r * 2);
        if (isSel(sel)) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * px; ctx.strokeRect(l.x + dx - r * 1.6, l.z + dz - r * 1.6, r * 3.2, r * 3.2); }
      }
      for (const sp of g.spawnPoints) {
        const sel: Selection = { kind: 'point', point: 'spawn', id: sp.id }, [dx, dz] = offsetOf(sel), r = 6 * px;
        ctx.beginPath(); ctx.moveTo(sp.x + dx, sp.z + dz - r); ctx.lineTo(sp.x + dx + r * .87, sp.z + dz + r * .5); ctx.lineTo(sp.x + dx - r * .87, sp.z + dz + r * .5); ctx.closePath();
        ctx.fillStyle = isSel(sel) ? '#ffb000' : '#47d16c'; ctx.fill(); ctx.strokeStyle = '#0b0c0d'; ctx.lineWidth = px; ctx.stroke();
        if (g.minSpawnSpacing && s > .2) circle(sp.x + dx, sp.z + dz, g.minSpawnSpacing / 2, 'rgba(71,209,108,.25)', 1);
      }
      for (const poi of g.pois) {
        const sel: Selection = { kind: 'point', point: 'poi', id: poi.id }, [dx, dz] = offsetOf(sel), r = 6 * px;
        ctx.beginPath(); ctx.moveTo(poi.x + dx, poi.z + dz - r); ctx.lineTo(poi.x + dx + r, poi.z + dz); ctx.lineTo(poi.x + dx, poi.z + dz + r); ctx.lineTo(poi.x + dx - r, poi.z + dz); ctx.closePath();
        ctx.fillStyle = isSel(sel) ? '#ffb000' : '#ecebe6'; ctx.fill();
      }
    }

    /* Warfare: the battlefield area, links, zones by owner, their points, bases and vehicle spawns. */
    const wf = doc.warfare;
    if (wf?.area && (p.warfareEdit || (wf.enabled && layers.gameplay))) {
      const ax = wf.area.x, az = wf.area.z, a = p.warfareEdit ? 1 : .5;
      ctx.globalAlpha = a;
      ctx.setLineDash([10 * px, 6 * px]); ctx.strokeStyle = '#ff8a5a'; ctx.lineWidth = 2 * px; ctx.strokeRect(ax - wf.area.half, az - wf.area.half, wf.area.half * 2, wf.area.half * 2); ctx.setLineDash([]);
      const col = (o: 'blue' | 'red' | null) => (o === 'blue' ? '#4fa3ff' : o === 'red' ? '#ff5a4a' : '#d6d6d6');
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]);
      for (const zn of wf.zones) for (const id of zn.links) { const o = wf.zones.find((q) => q.id === id); if (!o || o.id < zn.id) continue; ctx.beginPath(); ctx.moveTo(ax + zn.x, az + zn.z); ctx.lineTo(ax + o.x, az + o.z); ctx.stroke(); }
      ctx.setLineDash([]);
      wf.zones.forEach((zn, i) => {
        const on = isSel({ kind: 'wfZone', index: i }), c = col(zn.owner);
        ctx.beginPath(); ctx.arc(ax + zn.x, az + zn.z, zn.radius, 0, 6.283); ctx.fillStyle = `${c}38`; ctx.fill(); ctx.strokeStyle = on ? '#ffb000' : c; ctx.lineWidth = (on ? 3 : 2) * px; ctx.stroke();
        for (const sp of zn.spawns) { ctx.fillStyle = c; ctx.fillRect(ax + sp.x - 3 * px, az + sp.z - 3 * px, 6 * px, 6 * px); }
        for (const pt of zn.points) { ctx.fillStyle = '#ffd36b'; ctx.beginPath(); ctx.arc(ax + pt.x, az + pt.z, 3 * px, 0, 6.283); ctx.fill(); }
      });
      for (const side of ['blue', 'red'] as const) {
        const b = wf.bases?.[side]; if (!b) continue;
        const on = isSel({ kind: 'wfBase', side });
        ctx.fillStyle = col(side); ctx.fillRect(ax + b.x - 7 * px, az + b.z - 7 * px, 14 * px, 14 * px); ctx.strokeStyle = on ? '#ffb000' : '#000'; ctx.lineWidth = (on ? 3 : 1) * px; ctx.strokeRect(ax + b.x - 7 * px, az + b.z - 7 * px, 14 * px, 14 * px);
      }
      wf.vehicleSpawns.forEach((v, i) => {
        const on = isSel({ kind: 'wfVehicle', index: i }), x = ax + v.x, z = az + v.z, fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), r = 8 * px;
        ctx.beginPath(); ctx.moveTo(x + fx * r, z + fz * r); ctx.lineTo(x - fz * r * .6 - fx * r * .6, z + fx * r * .6 - fz * r * .6); ctx.lineTo(x + fz * r * .6 - fx * r * .6, z - fx * r * .6 - fz * r * .6); ctx.closePath();
        ctx.fillStyle = col(v.side); ctx.fill(); ctx.strokeStyle = on ? '#ffb000' : '#000'; ctx.lineWidth = (on ? 2.5 : 1) * px; ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    /* Environment: each climate zone in its biome's colour, its blend margin dashed. */
    if (p.envEdit && doc.environment) {
      const trace = (sh: EnvShape, grow: number) => {
        ctx.beginPath();
        if (sh.kind === 'circle') ctx.arc(sh.x, sh.z, sh.r + grow, 0, 6.283);
        else if (sh.kind === 'box') {
          const c = Math.cos(sh.yaw), sn = Math.sin(sh.yaw), hx = sh.hx + grow, hz = sh.hz + grow;
          ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([a, b], i) => { const x = sh.x + a * hx * c + b * hz * sn, z = sh.z - a * hx * sn + b * hz * c; if (i) ctx.lineTo(x, z); else ctx.moveTo(x, z); });
          ctx.closePath();
        } else { sh.points.forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z))); ctx.closePath(); }
      };
      for (const zn of doc.environment.zones) {
        const on = isSel({ kind: 'envZone', id: zn.id }), c = ENV_ZONE_COLOR[zn.biome] ?? '#cccccc';
        trace(zn.shape, 0); ctx.fillStyle = `${c}40`; ctx.fill(); ctx.strokeStyle = on ? '#ffb000' : c; ctx.lineWidth = (on ? 3 : 2) * px; ctx.stroke();
        // (A polygon's margin is drawn as its outline grown by the blend: close enough to read.)
        if (zn.blend > 0 && zn.shape.kind !== 'polygon') { ctx.setLineDash([6 * px, 5 * px]); trace(zn.shape, zn.blend); ctx.strokeStyle = `${c}aa`; ctx.lineWidth = 1.2 * px; ctx.stroke(); ctx.setLineDash([]); }
        if (on && zn.shape.kind === 'polygon') for (const [x, z] of zn.shape.points) { ctx.fillStyle = '#ffb000'; ctx.fillRect(x - 3 * px, z - 3 * px, 6 * px, 6 * px); }
        const b = shapeBounds(zn.shape);
        if (s > .05) { ctx.fillStyle = '#fff'; ctx.font = `${12 * px}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(zn.name, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2); }
      }
    }

    /* Validation markers. */
    for (const m of overlay.markers) { ctx.beginPath(); ctx.arc(m.x, m.z, 7 * px, 0, 6.283); ctx.strokeStyle = m.severity === 'error' ? '#ff3b30' : '#ffb000'; ctx.lineWidth = 2.5 * px; ctx.stroke(); }

    /* Polygon being drawn. */
    if (overlay.draft) {
      const pts = overlay.draft.points;
      if (pts.length) {
        path(pts, false); ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 2 * px; ctx.stroke();
        const h = hover.current;
        if (h && !gesture.current) { ctx.beginPath(); ctx.moveTo(...pts[pts.length - 1]!); ctx.lineTo(h.x, h.z); if (drawShape(overlay.draft.tool) !== 'river' && pts.length > 1) ctx.lineTo(...pts[0]!); ctx.setLineDash([5 * px, 4 * px]); ctx.strokeStyle = 'rgba(255,176,0,.7)'; ctx.lineWidth = 1.5 * px; ctx.stroke(); ctx.setLineDash([]); }
        pts.forEach(([x, z], i) => { ctx.fillStyle = i === 0 ? '#ffffff' : '#ffb000'; ctx.fillRect(x - 4 * px, z - 4 * px, 8 * px, 8 * px); });
      }
    }
    // Vertex handles of the selected shape.
    if (selection?.kind === 'shape' && p.tool === 'select') {
      const pts = shapeOf(p.doc, p.gameplay, selection.shape, selection.id);
      if (pts) shapePoints(selection.shape, selection.id, pts).forEach(([x, z], i) => { ctx.fillStyle = i === selection.vertex ? '#ffb000' : '#ffffff'; ctx.strokeStyle = '#0b0c0d'; ctx.lineWidth = px; ctx.fillRect(x - 4 * px, z - 4 * px, 8 * px, 8 * px); ctx.strokeRect(x - 4 * px, z - 4 * px, 8 * px, 8 * px); });
    }
    /* Brush outline. */
    const h = hover.current, b = overlay.brush;
    if (h && b && isBrush(p.tool)) {
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.5 * px;
      if (b.shape === 'square') ctx.strokeRect(h.x - b.radius, h.z - b.radius, b.radius * 2, b.radius * 2); else { ctx.beginPath(); ctx.arc(h.x, h.z, b.radius, 0, 6.283); ctx.stroke(); }
      const inner = b.radius * (1 - b.falloff);
      if (inner > 1) { ctx.strokeStyle = 'rgba(255,176,0,.8)'; ctx.setLineDash([4 * px, 4 * px]); if (b.shape === 'square') ctx.strokeRect(h.x - inner, h.z - inner, inner * 2, inner * 2); else { ctx.beginPath(); ctx.arc(h.x, h.z, inner, 0, 6.283); ctx.stroke(); } ctx.setLineDash([]); }
    }

    /* Screen-space labels and the scale bar. */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '600 11px "Noto Sans", "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const labels: Array<{ x: number; y: number; text: string; color: string }> = [];
    if (layers.gameplay && gameplay && s > .12) for (const poi of gameplay.pois) labels.push({ x: (poi.x - v.cx) * s + v.w / 2, y: (poi.z - v.cz) * s + v.h / 2 - 14, text: poi.name, color: '#ecebe6' });
    if (layers.regions) for (const r of doc.regions) { const c = centroid(r.polygon); labels.push({ x: (c[0] - v.cx) * s + v.w / 2, y: (c[1] - v.cz) * s + v.h / 2, text: r.name, color: '#ffcf66' }); }
    const placed: Array<[number, number, number]> = [];
    for (const l of labels) {
      const w = ctx.measureText(l.text).width + 10;
      if (l.x < -w || l.y < -10 || l.x > v.w + w || l.y > v.h + 10 || placed.some(([x, y, pw]) => Math.abs(x - l.x) < (w + pw) / 2 && Math.abs(y - l.y) < 17)) continue;
      placed.push([l.x, l.y, w]);
      ctx.fillStyle = 'rgba(11,12,13,.78)'; ctx.fillRect(l.x - w / 2, l.y - 8, w, 16); ctx.fillStyle = l.color; ctx.fillText(l.text, l.x, l.y + .5);
    }
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((m) => m * s >= 70) ?? 5000;
    ctx.fillStyle = 'rgba(11,12,13,.72)'; ctx.fillRect(10, v.h - 30, nice * s + 20, 20);
    ctx.fillStyle = '#ecebe6'; ctx.fillRect(20, v.h - 18, nice * s, 3); ctx.textAlign = 'left'; ctx.font = '600 10px "Noto Sans", sans-serif';
    ctx.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 20, v.h - 24);
  }, []);

  const schedule = useCallback(() => { if (!frame.current) frame.current = requestAnimationFrame(draw); }, [draw]);

  const fit = useCallback(() => {
    const v = view.current, size = live.current.terrain.size;
    // Not laid out yet: the resize observer fits once the element has a size.
    if (v.w <= 1 || v.h <= 1) { v.scale = 0; return; }
    v.cx = size / 2; v.cz = size / 2; v.scale = Math.min(v.w, v.h) / size * .94;
    schedule();
  }, [schedule]);

  useImperativeHandle(ref, () => ({
    fit,
    zoom: (f: number) => { view.current.scale = clampScale(view.current.scale * f); schedule(); },
    centerOn: (x: number, z: number, span?: number) => { const v = view.current; v.cx = x; v.cz = z; if (span) v.scale = clampScale(Math.min(v.w, v.h) / span); schedule(); },
  }), [fit, schedule]);

  // Size to the element (crisp on high-DPI screens).
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, v = view.current;
      v.w = Math.max(1, r.width); v.h = Math.max(1, r.height);
      canvas.width = Math.round(v.w * dpr); canvas.height = Math.round(v.h * dpr);
      if (!v.scale) fit(); else schedule();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [fit, schedule]);
  useEffect(() => { fit(); }, [props.terrain, fit]);
  useEffect(schedule, [props.version, props.doc, props.overlay, props.layers, props.selection, props.tool, props.gameplay, schedule]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { space.current = true; e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
  // Reset the handle too: React's strict mode remounts, and a stale handle would block every redraw.
  useEffect(() => () => { cancelAnimationFrame(frame.current); frame.current = 0; }, []);
  function clampScale(sc: number) { const size = live.current.terrain.size; return Math.max(Math.min(view.current.w, view.current.h) / size * .3, Math.min(24, sc)); }

  // Wheel zoom around the cursor (non-passive so the page never scrolls).
  useEffect(() => {
    const canvas = canvasRef.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect(), v = view.current;
      const [wx, wz] = toWorld(e.clientX - r.left, e.clientY - r.top);
      v.scale = clampScale(v.scale * Math.pow(1.0018, -e.deltaY));
      v.cx = wx - (e.clientX - r.left - v.w / 2) / v.scale; v.cz = wz - (e.clientY - r.top - v.h / 2) / v.scale;
      schedule();
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
     
  }, [schedule, toWorld]);

  const hitTest = (x: number, z: number): Selection | null => {
    const p = live.current, tol = 8 / view.current.scale;
    const sel = p.selection;
    if (sel?.kind === 'shape') {
      const pts = shapeOf(p.doc, p.gameplay, sel.shape, sel.id);
      const i = pts?.findIndex(([px, pz]) => Math.hypot(px - x, pz - z) < tol) ?? -1;
      if (i >= 0) return { ...sel, vertex: i };
    }
    if (p.envEdit) {
      const env = p.doc.environment;
      if (sel?.kind === 'envZone') {
        const zn = env?.zones.find((q) => q.id === sel.id);
        if (zn?.shape.kind === 'polygon') { const i = zn.shape.points.findIndex(([px, pz]) => Math.hypot(px - x, pz - z) < tol); if (i >= 0) return { kind: 'shape', shape: 'envzone', id: zn.id, vertex: i }; }
      }
      // The top zone under the cursor (the one laid last).
      const hit = env ? [...zonesInOrder(env)].reverse().find((q) => shapeDistance(q.shape, x, z) <= 0) : undefined;
      return hit ? { kind: 'envZone', id: hit.id } : null;
    }
    const wf = p.doc.warfare;
    if (p.warfareEdit && wf?.area) {
      const lx = x - wf.area.x, lz = z - wf.area.z;
      const vi = wf.vehicleSpawns.findIndex((v) => Math.hypot(v.x - lx, v.z - lz) < tol * 1.2); if (vi >= 0) return { kind: 'wfVehicle', index: vi };
      for (const side of ['blue', 'red'] as const) { const b = wf.bases?.[side]; if (b && Math.hypot(b.x - lx, b.z - lz) < tol * 1.2) return { kind: 'wfBase', side }; }
      const zi = wf.zones.findIndex((zn) => Math.hypot(zn.x - lx, zn.z - lz) <= zn.radius); if (zi >= 0) return { kind: 'wfZone', index: zi };
      return null;
    }
    const g = p.gameplay;
    if (p.layers.gameplay && g) {
      const near = <T extends { id: string; x: number; z: number }>(list: T[], r = tol) => list.find((q) => Math.hypot(q.x - x, q.z - z) < r);
      const sp = near(g.spawnPoints); if (sp) return { kind: 'point', point: 'spawn', id: sp.id };
      const poi = near(g.pois); if (poi) return { kind: 'point', point: 'poi', id: poi.id };
      const lt = near(g.loot.points, tol * .8); if (lt) return { kind: 'point', point: 'loot', id: lt.id };
      if (Math.hypot(g.playArea.x - x, g.playArea.z - z) < tol * 1.4) return { kind: 'play-area' };
      const hs = near(g.hotspots, tol * 1.4); if (hs) return { kind: 'point', point: 'hotspot', id: hs.id };
      const ra = near(g.loot.rareAreas, tol * 1.4); if (ra) return { kind: 'point', point: 'rare', id: ra.id };
      const ph = g.phases.findIndex((q) => q.center && Math.hypot(q.center[0] - x, q.center[1] - z) < tol * 1.4); if (ph >= 0) return { kind: 'phase', index: ph };
    }
    if (p.layers.regions) for (const r of p.doc.regions) {
      if (!r.result || !pointInPolygon(x, z, r.polygon)) continue;
      const b = r.result.buildings.find((q) => pointInPolygon(x, z, obbCorners(q.obb)));
      if (b) return { kind: 'building', region: r.id, id: b.id };
      if (p.layers.props && view.current.scale > .35) { const q = r.result.props.find((o) => Math.hypot(o.x - x, o.z - z) < Math.max(tol * .6, Math.max(o.obb.hx, o.obb.hz))); if (q) return { kind: 'prop', region: r.id, id: q.id }; }
    }
    if (g && p.layers.gameplay) {
      const nz = g.noGoZones.find((q) => pointInPolygon(x, z, q.polygon)); if (nz) return { kind: 'shape', shape: 'nogo', id: nz.id };
      const sz = g.spawnZones.find((q) => pointInPolygon(x, z, q.polygon)); if (sz) return { kind: 'shape', shape: 'spawnzone', id: sz.id };
    }
    if (p.layers.regions) { const r = p.doc.regions.find((q) => pointInPolygon(x, z, q.polygon)); if (r) return { kind: 'shape', shape: 'region', id: r.id }; }
    if (p.layers.water) {
      const lake = p.doc.water.lakes.find((q) => pointInPolygon(x, z, q.polygon)); if (lake) return { kind: 'shape', shape: 'lake', id: lake.id };
      const river = p.doc.water.rivers.find((q) => distanceToPolyline(x, z, q.points.map((o) => [o.x, o.z])) < Math.max(...q.points.map((o) => o.width)) / 2 + tol); if (river) return { kind: 'shape', shape: 'river', id: river.id };
    }
    return null;
  };

  const local = (e: React.PointerEvent | React.MouseEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = live.current, [lx, ly] = local(e), [x, z] = toWorld(lx, ly), tol = 9 / view.current.scale;
    e.currentTarget.setPointerCapture(e.pointerId);
    const draft = p.overlay.draft;
    if (e.button === 2 && draft) {
      const i = draft.points.findIndex(([px, pz]) => Math.hypot(px - x, pz - z) < tol);
      if (i >= 0) { p.onDraft(draft.points.filter((_, k) => k !== i)); return; }
    }
    if (e.button === 1 || e.button === 2 || space.current || p.tool === 'pan') { gesture.current = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: view.current.cx, cz: view.current.cz }; return; }
    if (e.button !== 0) return;
    if (isBrush(p.tool)) { gesture.current = { type: 'brush' }; p.onBrush('start', x, z); return; }
    if (isDraw(p.tool)) {
      const pts = draft?.points ?? [];
      const i = pts.findIndex(([px, pz]) => Math.hypot(px - x, pz - z) < tol);
      if (i === 0 && pts.length >= (drawShape(p.tool) === 'river' ? 2 : 3)) { p.onDraftFinish(); return; }
      if (i >= 0) { gesture.current = { type: 'draft-vertex', index: i }; return; }
      // Insert on an edge, or append.
      for (let k = 1; k < pts.length; k++) if (distanceToPolyline(x, z, [pts[k - 1]!, pts[k]!]) < tol * .6) { const next = [...pts]; next.splice(k, 0, [x, z]); p.onDraft(next); gesture.current = { type: 'draft-vertex', index: k }; return; }
      p.onDraft([...pts, [x, z]]);
      return;
    }
    if (p.tool === 'select') {
      const hit = hitTest(x, z);
      p.onSelect(hit);
      if (hit && hit.kind !== 'shape') { const at = anchorOf(p, hit); if (at) gesture.current = { type: 'drag', sel: hit, ox: at[0], oz: at[1], x: at[0], z: at[1], moved: false }; }
      else if (hit?.kind === 'shape' && hit.vertex !== undefined) { const pts = shapeOf(p.doc, p.gameplay, hit.shape, hit.id)!; const q = pts[hit.vertex]!; gesture.current = { type: 'drag', sel: hit, ox: q[0], oz: q[1], x: q[0], z: q[1], moved: false }; }
      else if (!hit) gesture.current = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: view.current.cx, cz: view.current.cz };
      return;
    }
    p.onPlace(x, z);
  };
  const dragStart = useRef<Vec2>([0, 0]);
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = live.current, [lx, ly] = local(e), [x, z] = toWorld(lx, ly), g = gesture.current;
    hover.current = { x, z };
    p.onHover({ x, z, height: p.terrain.heightAt(x, z), scale: view.current.scale });
    if (g?.type === 'pan') { const v = view.current; v.cx = g.cx - (e.clientX - g.sx) / v.scale; v.cz = g.cz - (e.clientY - g.sy) / v.scale; }
    else if (g?.type === 'brush') p.onBrush('move', x, z);
    else if (g?.type === 'draft-vertex' && p.overlay.draft) p.onDraft(p.overlay.draft.points.map((q, i) => (i === g.index ? [x, z] as Vec2 : q)));
    else if (g?.type === 'drag') {
      if (!g.moved) { dragStart.current = [x, z]; g.moved = true; }
      g.x = g.ox + x - dragStart.current[0]; g.z = g.oz + z - dragStart.current[1];
    }
    schedule();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = live.current, g = gesture.current, [lx, ly] = local(e), [x, z] = toWorld(lx, ly);
    gesture.current = null;
    if (g?.type === 'brush') p.onBrush('end', x, z);
    if (g?.type === 'drag' && g.moved) p.onMove(g.sel, g.x, g.z);
    schedule();
  };

  const cursor = props.tool === 'pan' ? 'grab' : isBrush(props.tool) ? 'none' : isDraw(props.tool) || props.tool.startsWith('place-') || props.tool.startsWith('wf-') || props.tool.startsWith('env-') ? 'crosshair' : 'default';
  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', cursor, touchAction: 'none' }}
    aria-label="Bản đồ 2D" data-testid="map-canvas"
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
    onPointerLeave={() => { hover.current = null; live.current.onHover(null); schedule(); }}
    onDoubleClick={() => { if (live.current.overlay.draft) live.current.onDraftFinish(); }}
    onContextMenu={(e) => e.preventDefault()} />;
});

function centroid(poly: Vec2[]): Vec2 { return [poly.reduce((s, q) => s + q[0], 0) / poly.length, poly.reduce((s, q) => s + q[1], 0) / poly.length]; }

/** The outline points of a shape, by type and id. */
export function shapeOf(doc: WorldMapDoc, g: BattleConfig | undefined, shape: string, id: string): Vec2[] | null {
  if (shape === 'region') return doc.regions.find((r) => r.id === id)?.polygon ?? null;
  if (shape === 'lake') return doc.water.lakes.find((r) => r.id === id)?.polygon ?? null;
  if (shape === 'river') return doc.water.rivers.find((r) => r.id === id)?.points.map((q) => [q.x, q.z] as Vec2) ?? null;
  if (shape === 'nogo') return g?.noGoZones.find((r) => r.id === id)?.polygon ?? null;
  if (shape === 'spawnzone') return g?.spawnZones.find((r) => r.id === id)?.polygon ?? null;
  if (shape === 'envzone') { const z = doc.environment?.zones.find((r) => r.id === id); return z?.shape.kind === 'polygon' ? z.shape.points : null; }
  return null;
}

/** Where a draggable item sits now. */
function anchorOf(p: Props, sel: Selection): Vec2 | null {
  const g = p.gameplay, wf = p.doc.warfare;
  if ((sel.kind === 'wfZone' || sel.kind === 'wfVehicle' || sel.kind === 'wfBase') && wf?.area) {
    const q = sel.kind === 'wfZone' ? wf.zones[sel.index] : sel.kind === 'wfVehicle' ? wf.vehicleSpawns[sel.index] : wf.bases?.[sel.side];
    return q ? [wf.area.x + q.x, wf.area.z + q.z] : null;
  }
  if (sel.kind === 'envZone') {
    const sh = p.doc.environment?.zones.find((q) => q.id === sel.id)?.shape;
    if (!sh) return null;
    if (sh.kind !== 'polygon') return [sh.x, sh.z];
    return [sh.points.reduce((a, q) => a + q[0], 0) / sh.points.length, sh.points.reduce((a, q) => a + q[1], 0) / sh.points.length];
  }
  if (sel.kind === 'play-area') return g ? [g.playArea.x, g.playArea.z] : null;
  if (sel.kind === 'phase') { const c = g?.phases[sel.index]?.center; return c ? [c[0], c[1]] : null; }
  if (sel.kind === 'point' && g) {
    const list = sel.point === 'spawn' ? g.spawnPoints : sel.point === 'poi' ? g.pois : sel.point === 'loot' ? g.loot.points : sel.point === 'hotspot' ? g.hotspots : g.loot.rareAreas;
    const q = (list as Array<{ id: string; x: number; z: number }>).find((o) => o.id === sel.id);
    return q ? [q.x, q.z] : null;
  }
  if (sel.kind === 'building' || sel.kind === 'prop') {
    const r = p.doc.regions.find((o) => o.id === sel.region)?.result;
    const q = sel.kind === 'building' ? r?.buildings.find((o) => o.id === sel.id) : r?.props.find((o) => o.id === sel.id);
    return q ? [q.obb.x, q.obb.z] : null;
  }
  return null;
}
