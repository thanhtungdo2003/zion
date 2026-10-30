import type { WarfareSide, WarfareStateMessage } from '@zion/shared';

const SIDE: Record<WarfareSide, string> = { blue: '#4fa3ff', red: '#ff5a4a' };

/**
 * Warfare on a map canvas (the minimap and the M map share it): zones by owner with their letter,
 * the two bases, vehicles as small silhouettes (blue: our crew, red: the enemy's when seen, white:
 * empty) and our commanders as dots with the way they face. Rank-and-file soldiers are left off.
 * `to` maps world metres to canvas pixels (drawn in the world frame: yaw 0 faces −Z, positive
 * yaw turns left); `scale` is pixels per metre; `upright` turns the zone letters back upright on a
 * rotated map.
 */
export function drawWarfareOverlay(ctx: CanvasRenderingContext2D, wf: WarfareStateMessage | null, selfId: number | null, to: (x: number, z: number) => { x: number; y: number }, scale: number, upright = 0): void {
  const you = wf?.you;
  if (!wf || !you) return;
  ctx.save();
  for (const z of wf.zones) {
    const p = to(z.x, z.z), r = Math.max(6, z.radius * scale);
    const c = z.owner ? SIDE[z.owner] : '#d6d6d6';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.globalAlpha = .22; ctx.fillStyle = c; ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = z.contested ? 2.5 : 1.5; ctx.strokeStyle = z.contested ? '#ffb000' : c; ctx.setLineDash(z.contested ? [4, 3] : []); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = `800 ${Math.max(10, Math.min(16, r * .7))}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(upright);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(z.name.slice(0, 1), 0, 0); ctx.fillStyle = '#fff'; ctx.fillText(z.name.slice(0, 1), 0, 0);
    ctx.restore();
  }
  for (const side of ['blue', 'red'] as const) {
    const b = to(wf.bases[side].x, wf.bases[side].z);
    ctx.fillStyle = SIDE[side]; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2;
    ctx.fillRect(b.x - 5, b.y - 5, 10, 10); ctx.strokeRect(b.x - 5, b.y - 5, 10, 10);
  }
  for (const v of wf.vehicles) {
    const p = to(v.x, v.z), c = v.crew === null ? '#f4f4f4' : v.crew === you.side ? SIDE.blue : SIDE.red;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-v.yaw);
    ctx.fillStyle = c; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    if (v.air) { ctx.fillRect(-1.5, -8, 3, 14); ctx.strokeRect(-1.5, -8, 3, 14); ctx.fillRect(-7, -3, 14, 2.2); ctx.strokeRect(-7, -3, 14, 2.2); }
    else { ctx.fillRect(-3.5, -5, 7, 10); ctx.strokeRect(-3.5, -5, 7, 10); ctx.fillRect(-.8, -9, 1.6, 4); }
    ctx.restore();
  }
  const followers = new Set(you.followers);
  for (const u of wf.units) {
    if (!u.alive || u.x === undefined || u.z === undefined || u.id === selfId) continue;
    if (!u.lead && !followers.has(u.id)) continue;
    const p = to(u.x, u.z), c = followers.has(u.id) ? '#9fe870' : SIDE[u.side], r = u.lead ? 4 : 3;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-(u.yaw ?? 0));
    ctx.fillStyle = c; ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (u.lead) { ctx.beginPath(); ctx.moveTo(0, -r - 5); ctx.lineTo(r * .9, -r + .5); ctx.lineTo(-r * .9, -r + .5); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
  ctx.restore();
}
