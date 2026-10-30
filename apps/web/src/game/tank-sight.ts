/**
 * The gunner's sight overlay of a tank: a reticle at the centre (where the mouse aims), a ring
 * where the gun actually points while the turret is still traversing, and the dark edge of the
 * eyepiece when magnified. Plain DOM, positioned every frame without touching React.
 */
export class TankSight {
  private root: HTMLDivElement | null = null;
  private gun: HTMLElement | null = null;
  private shown = false;

  private build(): HTMLDivElement {
    const root = document.createElement('div');
    root.className = 'tank-sight';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '<svg class="tank-sight-reticle" viewBox="-60 -60 120 120"><path d="M-46 0H-10M10 0H46M0 10V40M-6 18H6M-4 26H4M-6 34H6"/><path d="M-8 -6L0 2L8 -6"/></svg><i class="tank-sight-gun"></i><span class="tank-sight-zoom"></span>';
    document.body.appendChild(root);
    this.gun = root.querySelector('.tank-sight-gun');
    return root;
  }

  /** `gun`: where the barrel points on screen (NDC −1…1), or null when off screen. */
  update(zoomed: boolean, gun: { x: number; y: number } | null, ready: boolean): void {
    if (typeof document === 'undefined') return;
    const root = this.root ??= this.build();
    if (!this.shown) { root.style.display = ''; this.shown = true; }
    root.classList.toggle('zoomed', zoomed);
    root.classList.toggle('laid', ready);
    if (this.gun) {
      this.gun.style.display = gun ? '' : 'none';
      if (gun) this.gun.style.transform = `translate(${((gun.x + 1) * 50).toFixed(2)}vw, ${((1 - gun.y) * 50).toFixed(2)}vh)`;
    }
  }

  hide(): void {
    if (this.root && this.shown) { this.root.style.display = 'none'; this.shown = false; }
  }

  dispose(): void { this.root?.remove(); this.root = null; this.gun = null; this.shown = false; }
}
