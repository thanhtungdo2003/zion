import lucide from '@iconify-json/lucide/icons.json';

const images = new Map<string, HTMLImageElement>();
export function drawLocationIcon(ctx: CanvasRenderingContext2D, icon: string, x: number, y: number, r = 7): void {
  ctx.fillStyle = '#141b18'; ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const name = icon.replace('lucide:', ''), cached = images.get(name);
  if (cached?.complete && cached.naturalWidth) { ctx.drawImage(cached, x - r, y - r, r * 2, r * 2); return; }
  const data = lucide.icons[name as keyof typeof lucide.icons];
  if (!cached && data) {
    const img = new Image(); img.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" color="#ffb000">${data.body}</svg>`)}`;
    images.set(name, img);
  }
  ctx.fillStyle = '#ffb000'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
}
