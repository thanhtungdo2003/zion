import { Buttons } from '@zion/shared';

/**
 * Keyboard/mouse capture for the top-down view. Produces intent only (screen-relative axes,
 * buttons, cursor position); it never moves anything itself. The cursor stays free: the engine
 * turns it into an aim point on the ground, and the character faces that point.
 */
export class InputController {
  yaw = 0;
  pitch = 0;
  /** Cursor in normalised device coordinates (−1…1, y up). */
  readonly pointer = { x: 0, y: 0 };
  /** First-person: the mouse turns the view (pointer lock) instead of moving a free cursor. */
  firstPerson = false;
  /** Mouse-look radians per pixel. */
  sensitivity = 0.001;
  private suspendedFlag = false;
  /** When true (chat open, menus), gameplay keys are ignored; first-person frees the cursor. */
  get suspended(): boolean {
    return this.suspendedFlag;
  }
  set suspended(v: boolean) {
    if (v === this.suspendedFlag) return;
    this.suspendedFlag = v;
    this.syncPointer();
  }
  private freeCursorFlag = false;
  /** First-person only: release the mouse for an on-screen panel (dialogue, death screen). */
  set freeCursor(v: boolean) {
    if (v === this.freeCursorFlag) return;
    this.freeCursorFlag = v;
    this.syncPointer();
  }
  private get wantsLock(): boolean {
    return this.firstPerson && this.active && !this.suspendedFlag && !this.freeCursorFlag;
  }
  private syncPointer(): void {
    if (this.wantsLock) this.lockPointer();
    else this.unlockPointer();
  }
  private active = false;
  private readonly keys = new Set<string>();
  private mouseButtons = 0;
  private readonly onChat: () => void;
  private readonly onActiveChange: (active: boolean) => void;
  private readonly handlers: { openInventory: () => void; hotbar: (slot: number) => void; cycleHotbar: (dir: number) => void; reload: () => void; heal: () => void; escape?: () => boolean };
  private readonly cleanup: Array<() => void> = [];

  constructor(
    private readonly element: HTMLElement,
    handlers: {
      openChat: () => void;
      activeChange: (active: boolean) => void;
      openInventory: () => void;
      hotbar: (slot: number) => void;
      cycleHotbar: (dir: number) => void;
      reload: () => void;
      heal: () => void;
      /** Esc pressed in game: return true when something (a dialogue) used it. */
      escape?: () => boolean;
    },
  ) {
    this.onChat = handlers.openChat;
    this.onActiveChange = handlers.activeChange;
    this.handlers = handlers;
    element.style.cursor = 'crosshair';
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      window.addEventListener(type, fn, opts);
      this.cleanup.push(() => window.removeEventListener(type, fn));
    };
    on('keydown', (e) => {
      // Esc pauses, and pressed again resumes (unless a menu / chat has the keyboard).
      if (e.code === 'Escape' && !this.suspended && !e.repeat) {
        if (this.handlers.escape?.()) return;
        if (this.active) this.release();
        else this.requestLock();
        return;
      }
      if (this.suspended || !this.active) return;
      if (e.code === 'Enter' || e.code === 'KeyT') {
        e.preventDefault();
        this.keys.clear();
        this.onChat();
        return;
      }
      if (e.code === 'KeyE' && !e.repeat) {
        this.keys.clear();
        this.mouseButtons = 0;
        this.handlers.openInventory();
        return;
      }
      if (e.code === 'KeyQ' && !e.repeat) this.handlers.cycleHotbar(1);
      if (e.code === 'KeyR' && !e.repeat) this.handlers.reload();
      if (e.code === 'KeyH' && !e.repeat) this.handlers.heal();
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit && !e.repeat) this.handlers.hotbar(Number(digit[1]) - 1);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    on('keyup', (e) => this.keys.delete(e.code));
    on('blur', () => {
      this.keys.clear();
      this.mouseButtons = 0;
    });
    on('mousemove', (e) => {
      if (this.wantsLock && this.pointerLocked) {
        // Browsers occasionally report a huge jump right after the lock engages: drop it.
        if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
        // Yaw stays in −π…π: the server rejects inputs outside that range.
        const yaw = this.yaw - e.movementX * this.sensitivity;
        this.yaw = yaw - Math.PI * 2 * Math.floor((yaw + Math.PI) / (Math.PI * 2));
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - e.movementY * this.sensitivity));
      }
      const r = this.element.getBoundingClientRect();
      this.pointer.x = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
      this.pointer.y = -(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1);
    });
    on('mousedown', (e) => {
      if (this.active && !this.suspended && e.target === this.element) this.mouseButtons |= 1 << e.button;
    });
    on('mouseup', (e) => {
      this.mouseButtons &= ~(1 << e.button);
    });
    // The wheel scrolls through the weapon slots (the camera distance is fixed).
    let wheelAt = 0;
    const wheel = (e: WheelEvent) => {
      if (!this.active || this.suspended) return;
      e.preventDefault();
      const now = performance.now();
      if (now - wheelAt < 90 || Math.abs(e.deltaY) < 1) return;
      wheelAt = now;
      this.handlers.cycleHotbar(Math.sign(e.deltaY));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    this.cleanup.push(() => element.removeEventListener('wheel', wheel));
    const menu = (e: Event) => e.preventDefault();
    element.addEventListener('contextmenu', menu);
    this.cleanup.push(() => element.removeEventListener('contextmenu', menu));
    const click = () => {
      if (!this.active && !this.suspended) this.requestLock();
      else if (this.wantsLock) this.lockPointer();
    };
    // Esc while pointer-locked is eaten by the browser: losing the lock pauses the game.
    const lockChange = () => {
      if (!this.pointerLocked && this.wantsLock) this.release();
    };
    document.addEventListener('pointerlockchange', lockChange);
    this.cleanup.push(() => document.removeEventListener('pointerlockchange', lockChange));
    element.addEventListener('click', click);
    this.cleanup.push(() => element.removeEventListener('click', click));
  }

  /** Right mouse button held (sniper scope). */
  get aiming(): boolean {
    return !this.suspended && this.active && (this.mouseButtons & 4) !== 0;
  }

  /** True while the player is "in" the game (clicked in, not paused with Esc). */
  get locked(): boolean {
    return this.active;
  }

  private get pointerLocked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.element;
  }

  private lockPointer(): void {
    if (!this.firstPerson || this.pointerLocked) return;
    try {
      void Promise.resolve(this.element.requestPointerLock()).catch(() => undefined);
    } catch {
      /* needs a user gesture: the next click on the view locks it */
    }
  }

  private unlockPointer(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  /** Switches between the top-down free cursor and first-person mouse look. */
  setFirstPerson(on: boolean): void {
    if (on === this.firstPerson) return;
    this.firstPerson = on;
    this.element.style.cursor = on ? 'none' : 'crosshair';
    this.syncPointer();
  }

  requestLock(): void {
    if (this.active) return;
    this.active = true;
    this.syncPointer();
    this.onActiveChange(true);
  }

  release(): void {
    if (!this.active) return;
    this.unlockPointer();
    this.active = false;
    this.keys.clear();
    this.mouseButtons = 0;
    this.onActiveChange(false);
  }

  /** Movement axes in screen space (x = screen right, z = screen up / away from camera). */
  axes(): { mx: number; mz: number } {
    if (this.suspended || !this.active) return { mx: 0, mz: 0 };
    const k = this.keys;
    const mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    return { mx, mz };
  }

  buttons(): number {
    if (this.suspended || !this.active) return 0;
    let b = 0;
    if (this.keys.has('Space')) b |= Buttons.Jump;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) b |= Buttons.Sprint;
    if (this.mouseButtons & 1) b |= Buttons.Attack;
    if (this.keys.has('KeyC')) b |= Buttons.Roll;
    return b;
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
  }
}
