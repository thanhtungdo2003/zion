'use client';

import { useEffect, useRef } from 'react';
import { authoredWorld, townParcels, type WorldGenerator } from '@zion/worldgen';

export interface MapViewport { x: number; z: number; span: number }
export interface MapLayers { roads: boolean; buildings: boolean; parcels: boolean; labels: boolean }
export const FULL_ISLAND: MapViewport = { x: 2048, z: 2048, span: 4096 };
export function constrainViewport(view: MapViewport): MapViewport {
  const span = Math.max(256, Math.min(4096, view.span));
  return { span, x: Math.max(span / 2, Math.min(4096 - span / 2, view.x)), z: Math.max(span / 2, Math.min(4096 - span / 2, view.z)) };
}

export default function WorldMapCanvas({ gen, viewport, layers, onPan, onPosition, onSculpt, label }: {
  gen: WorldGenerator; viewport: MapViewport; layers: MapLayers;
  onPan: (view: MapViewport) => void;
  onPosition: (position: { x: number; z: number } | null) => void;
  onSculpt?: (x: number, z: number) => void; label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; view: MapViewport } | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const size = 512, step = viewport.span / size;
    const x0 = viewport.x - viewport.span / 2, z0 = viewport.z - viewport.span / 2;
    const world = authoredWorld(gen), heights = new Float32Array(size * size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) heights[j * size + i] = gen.heightAt(x0 + (i + .5) * step, z0 + (j + .5) * step);
    const pixels = ctx.createImageData(size, size);
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
      const index = j * size + i, h = heights[index]!;
      const dx = heights[j * size + Math.min(i + 1, size - 1)]! - h;
      const dz = heights[Math.min(j + 1, size - 1) * size + i]! - h;
      const shade = Math.max(.52, Math.min(1.35, 1 - (dx + dz) / step * .5));
      const depth = Math.min(1, Math.max(0, (gen.seaLevel - h) / 25));
      const colour = h < gen.seaLevel ? [25 - depth * 10, 53 - depth * 15, 64 - depth * 15] : h < gen.seaLevel + 3 ? [145, 143, 106] : h > 100 ? [112, 118, 100] : [83, 111, 82];
      for (let k = 0; k < 3; k++) pixels.data[index * 4 + k] = colour[k]! * shade;
      pixels.data[index * 4 + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    if (layers.roads) for (const road of world.map.roads) {
      ctx.strokeStyle = road.paved ? '#d2c6a7' : '#9b896c'; ctx.lineWidth = Math.max(1, 2 * road.width / step); ctx.lineJoin = 'round'; ctx.beginPath();
      road.points.forEach(([x, z], i) => i ? ctx.lineTo((x - x0) / step, (z - z0) / step) : ctx.moveTo((x - x0) / step, (z - z0) / step)); ctx.stroke();
    }
    if (layers.parcels) {
      ctx.strokeStyle = '#71c8b2'; ctx.lineWidth = .8;
      for (const parcel of [...townParcels(world.map), ...(world.map.extraBuildings ?? []).flatMap(b => b.lot ? [b.lot] : [])]) {
        ctx.beginPath(); parcel.polygon.forEach(([x, z], i) => i ? ctx.lineTo((x - x0) / step, (z - z0) / step) : ctx.moveTo((x - x0) / step, (z - z0) / step)); ctx.closePath(); ctx.stroke();
      }
    }
    if (layers.buildings) {
      ctx.fillStyle = '#e9b968';
      for (const site of world.structures()) if (site.parts.length && site.radius > 2) {
        const hx = site.halfX ?? site.radius * .5, hz = site.halfZ ?? site.radius * .5;
        ctx.save(); ctx.translate((site.x - x0) / step, (site.z - z0) / step); ctx.rotate(-site.yaw);
        ctx.fillRect(-hx / step, -hz / step, Math.max(1, hx * 2 / step), Math.max(1, hz * 2 / step)); ctx.restore();
      }
    }
    if (layers.labels) {
      ctx.font = '10px "Noto Sans", sans-serif'; ctx.textAlign = 'center';
      const labels: { x: number; y: number; w: number }[] = [];
      for (const area of world.areas()) {
        const x = (area.x - x0) / step, y = (area.z - z0) / step;
        if (x < 0 || y < 0 || x > size || y > size) continue;
        ctx.fillStyle = '#e9b968'; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
        const w = ctx.measureText(area.name).width + 8;
        const candidate = [-17, 8, -35, 26].map(offset => ({ x: Math.max(2, Math.min(size - w - 2, x - w / 2)), y: y + offset, w })).find(box => box.y >= 2 && box.y + 16 <= size - 2 && !labels.some(other => box.x < other.x + other.w + 3 && box.x + box.w + 3 > other.x && box.y < other.y + 19 && box.y + 19 > other.y));
        if (!candidate) continue;
        labels.push(candidate);
        ctx.strokeStyle = '#c4cdb177'; ctx.lineWidth = .6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(candidate.x + w / 2, candidate.y + 8); ctx.stroke();
        ctx.fillStyle = '#101b20e8'; ctx.fillRect(candidate.x, candidate.y, w, 16);
        ctx.fillStyle = '#edf0e8'; ctx.fillText(area.name, candidate.x + w / 2, candidate.y + 11);
      }
    }
  }, [gen, viewport, layers]);
  return <canvas ref={ref} width={512} height={512} aria-label={label} style={{ display: 'block', width: '100%', aspectRatio: '1', touchAction: 'none', cursor: onSculpt ? 'crosshair' : 'grab' }}
    onPointerDown={event => { if (!onSculpt) { drag.current = { x: event.clientX, y: event.clientY, view: viewport }; event.currentTarget.setPointerCapture(event.pointerId); } }}
    onPointerMove={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      onPosition({ x: viewport.x - viewport.span / 2 + (event.clientX - rect.left) / rect.width * viewport.span, z: viewport.z - viewport.span / 2 + (event.clientY - rect.top) / rect.height * viewport.span });
      if (drag.current) { const d = drag.current; onPan(constrainViewport({ ...d.view, x: d.view.x - (event.clientX - d.x) / rect.width * d.view.span, z: d.view.z - (event.clientY - d.y) / rect.height * d.view.span })); }
    }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onPointerLeave={() => onPosition(null)}
    onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); onSculpt?.(viewport.x - viewport.span / 2 + (event.clientX - rect.left) / rect.width * viewport.span, viewport.z - viewport.span / 2 + (event.clientY - rect.top) / rect.height * viewport.span); }} />;
}
