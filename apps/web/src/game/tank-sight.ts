/**
 * The gunner's sight of a tank: the screen is dark but for the round field of the sight.
 * - Reticle: the aiming chevron at the centre (where the mouse aims), a horizontal scale in
 *   mils for leading and lateral corrections, and a range scale below it (the drop of the
 *   gun's shell at 400 m steps, so a target that far is laid on that mark).
 * - Gun ring: where the gun actually points while the turret is still traversing; it turns
 *   green when the gun is laid.
 * - Hull indicator: a top-down outline of the hull with its nose (the "roof" of the house shape)
 *   pointing the way the hull faces, against the turret's line straight up: the hull's heading is
 *   never the turret's.
 * - Magnified (right button): the field narrows to the eyepiece.
 * Plain DOM, positioned every frame without touching React.
 */
export class TankSight {
  private root: HTMLDivElement | null = null;
  private gun: HTMLElement | null = null;
  private hull: SVGGElement | null = null;
  private zoom: HTMLElement | null = null;
  private range: HTMLElement | null = null;
  private shown = false;

  private build(): HTMLDivElement {
    const root = document.createElement('div');
    root.className = 'tank-sight';
    root.setAttribute('aria-hidden', 'true');
    // Mils: ±16 mils left and right, a tick every 4; range marks under the centre.
    const ticks = Array.from({ length: 9 }, (_, i) => { const x = (i - 4) * 12; return `<path d="M${x} ${x === 0 ? 0 : -3}V${i % 2 ? 4 : 7}"/>`; }).join('');
    const ranges = [4, 8, 12, 16, 20].map((hm, i) => { const y = 14 + i * 10; return `<path d="M-${5 - i * .5} ${y}H${5 - i * .5}"/><text x="9" y="${y + 2.5}">${hm}</text>`; }).join('');
    root.innerHTML = `<div class="tank-sight-field"></div>
<svg class="tank-sight-reticle" viewBox="-60 -60 120 120"><g class="mils"><path d="M-60 0H-8M8 0H60"/>${ticks}</g><path d="M-6 -6L0 1L6 -6" class="chevron"/><path d="M0 8V62" class="post"/><g class="ranges">${ranges}</g></svg>
<i class="tank-sight-gun"></i>
<svg class="tank-sight-hull" viewBox="-30 -30 60 60"><g class="hull"><path d="M-9 13V-5L0 -15L9 -5V13Z"/><path d="M-12 -2V14M12 -2V14" class="tracks"/></g><path d="M0 0V-24" class="turret"/><circle r="4" class="turret"/></svg>
<span class="tank-sight-label">THÂN XE</span><span class="tank-sight-zoomtag"></span>`;
    document.body.appendChild(root);
    this.gun = root.querySelector('.tank-sight-gun');
    this.hull = root.querySelector('.tank-sight-hull .hull');
    this.zoom = root.querySelector('.tank-sight-zoomtag');
    this.range = root.querySelector('.ranges');
    return root;
  }

  /**
   * `gun`: where the barrel points on screen (NDC −1…1), or null off screen; `hull`: the hull's
   * heading relative to where we look (radians, + = to the left).
   */
  update(zoomed: boolean, gun: { x: number; y: number } | null, laid: boolean, hull: number, magnification: number): void {
    if (typeof document === 'undefined') return;
    const root = this.root ??= this.build();
    if (!this.shown) { root.style.display = ''; this.shown = true; }
    root.classList.toggle('zoomed', zoomed);
    root.classList.toggle('laid', laid);
    if (this.gun) {
      this.gun.style.display = gun ? '' : 'none';
      if (gun) this.gun.style.transform = `translate(${((gun.x + 1) * 50).toFixed(2)}vw, ${((1 - gun.y) * 50).toFixed(2)}vh)`;
    }
    this.hull?.setAttribute('transform', `rotate(${(-hull * 180 / Math.PI).toFixed(1)})`);
    if (this.zoom) this.zoom.textContent = `${magnification.toFixed(1)}×`;
    if (this.range) this.range.style.display = zoomed ? '' : 'none';
  }

  hide(): void {
    if (this.root && this.shown) { this.root.style.display = 'none'; this.shown = false; }
  }

  dispose(): void { this.root?.remove(); this.root = null; this.gun = null; this.hull = null; this.shown = false; }
}
