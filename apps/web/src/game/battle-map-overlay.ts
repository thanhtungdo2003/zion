import type { BattleState } from '@zion/shared';

export function drawBattleCircles(ctx: CanvasRenderingContext2D, state: BattleState | null, to: (x: number, z: number) => { x: number; y: number }, scale: number): void {
  if (!state || state.phase !== 'running') return;
  ctx.save();
  const current = to(state.circle.x, state.circle.z), next = to(state.nextCircle.x, state.nextCircle.z);
  ctx.fillStyle = 'rgba(255,25,45,.19)';
  ctx.beginPath(); ctx.rect(-100000, -100000, 200000, 200000);
  ctx.arc(current.x, current.y, state.circle.radius * scale, 0, Math.PI * 2);
  ctx.fill('evenodd');
  ctx.strokeStyle = '#ff263d'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(current.x, current.y, state.circle.radius * scale, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.arc(next.x, next.y, state.nextCircle.radius * scale, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
