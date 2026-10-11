import { Buttons } from '@zion/shared';

export type TouchButton = 'attack' | 'aim' | 'sprint' | 'jump' | 'roll';
export type TouchAction = 'reload' | 'interact' | 'inventory' | 'heal' | 'weapon' | 'pause';
const TOUCH_BITS = { attack: Buttons.Attack, sprint: Buttons.Sprint, jump: Buttons.Jump, roll: Buttons.Roll };

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
  /** First-person / shoulder cameras turn with the mouse instead of a free cursor. */
  mouseLook = false;
  /** Mouse-look radians per pixel. */
  sensitivity = 0.001;
  /** Follow the current optical zoom so aiming keeps a consistent screen-space sensitivity. */
  lookScale = 1;
  private suspendedFlag = false;
  /** When true (chat open, menus), gameplay keys are ignored; first-person frees the cursor. */
  get suspended(): boolean {
    return this.suspendedFlag;
  }
  set suspended(v: boolean) {
    if (v === this.suspendedFlag) return;
    this.suspendedFlag = v;
    if (v) this.clearInput();
    this.syncPointer();
  }
  private freeCursorFlag = false;
  /** Release captured mouse-look for an on-screen panel (dialogue, death screen). */
  set freeCursor(v: boolean) {
    if (v === this.freeCursorFlag) return;
    this.freeCursorFlag = v;
    if (v) this.resetTouch();
    this.syncPointer();
  }
  private get wantsLock(): boolean {
    return this.mouseLook && !this.touchEnabled && this.active && !this.suspendedFlag && !this.freeCursorFlag;
  }
  private syncPointer(): void {
    if (this.wantsLock) this.lockPointer();
    else this.unlockPointer();
  }
  private active = false;
  private readonly keys = new Set<string>();
  private mouseButtons = 0;
  touchEnabled = false;
  /** Manual stick heading, kept separate from the assisted shot heading. */
  touchHeading: number | null = null;
  private touchX = 0;
  private touchZ = 0;
  private touchBits = 0;
  private touchPresses = 0;
  private touchAim = false;
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
      this.clearInput();
    });
    on('resize', () => this.resetTouch());
    const visibility = () => { if (document.hidden) this.clearInput(); };
    document.addEventListener('visibilitychange', visibility);
    this.cleanup.push(() => document.removeEventListener('visibilitychange', visibility));
    on('mousemove', (e) => {
      if (this.touchEnabled) return;
      if (this.wantsLock && this.pointerLocked) {
        // Browsers occasionally report a huge jump right after the lock engages: drop it.
        if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
        // Yaw stays in −π…π: the server rejects inputs outside that range.
        const yaw = this.yaw - e.movementX * this.sensitivity * this.lookScale;
        this.yaw = yaw - Math.PI * 2 * Math.floor((yaw + Math.PI) / (Math.PI * 2));
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - e.movementY * this.sensitivity * this.lookScale));
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
    return !this.suspended && this.active && ((this.mouseButtons & 4) !== 0 || this.touchAim);
  }

  setTouchEnabled(on: boolean): void {
    if (on === this.touchEnabled) return;
    this.touchEnabled = on;
    this.resetTouch();
    if (on) { this.pointer.x = 0; this.pointer.y = 0.35; }
    this.syncPointer();
  }

  resetTouch(): void {
    this.touchX = this.touchZ = this.touchBits = this.touchPresses = 0;
    this.touchAim = false;
  }

  private clearInput(): void {
    this.keys.clear();
    this.mouseButtons = 0;
    this.resetTouch();
  }

  touchMove(x: number, z: number): void {
    if (!this.touchEnabled || this.suspended || !this.active || this.freeCursorFlag) return;
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const length = Math.max(1, Math.hypot(x, z));
    this.touchX = x / length;
    this.touchZ = z / length;
  }

  touchButton(button: TouchButton, down: boolean): void {
    if (!down) {
      if (button === 'aim') this.touchAim = false;
      else this.touchBits &= ~TOUCH_BITS[button];
      return;
    }
    if (!this.touchEnabled || this.suspended || !this.active || this.freeCursorFlag) return;
    if (button === 'aim') this.touchAim = true;
    else {
      this.touchBits |= TOUCH_BITS[button];
      this.touchPresses |= TOUCH_BITS[button];
    }
  }

  /** Keep taps shorter than one simulation tick until the next input is sent. */
  acknowledgeTouchPresses(): void { this.touchPresses = 0; }

  touchLook(dx: number, dy: number, zoom = 1): void {
    if (!this.touchEnabled || this.suspended || !this.active || this.freeCursorFlag) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (this.mouseLook) {
      const yaw = this.yaw - dx * this.sensitivity * 2.5 * zoom * this.lookScale;
      this.yaw = yaw - Math.PI * 2 * Math.floor((yaw + Math.PI) / (Math.PI * 2));
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - dy * this.sensitivity * 2.5 * zoom * this.lookScale));
    } else {
      const rect = this.element.getBoundingClientRect();
      this.pointer.x = Math.max(-0.95, Math.min(0.95, this.pointer.x + dx * 2 / Math.max(1, rect.width)));
      this.pointer.y = Math.max(-0.95, Math.min(0.95, this.pointer.y - dy * 2 / Math.max(1, rect.height)));
    }
  }

  touchFireDirection(x: number, y: number, cameraYaw: number): void {
    if (!this.touchEnabled || this.mouseLook || this.suspended || !this.active || this.freeCursorFlag) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const length = Math.hypot(x, y);
    if (length > 0) {
      const wx = Math.cos(cameraYaw) * x + Math.sin(cameraYaw) * y;
      const wz = -Math.sin(cameraYaw) * x + Math.cos(cameraYaw) * y;
      this.touchHeading = Math.atan2(-wx, -wz);
    }
    this.touchButton('attack', length > 0);
  }

  /** True while the player is "in" the game (clicked in, not paused with Esc). */
  get locked(): boolean {
    return this.active;
  }

  private get pointerLocked(): boolean {
    return typeof document !== 'undefined' && document.pointerLockElement === this.element;
  }

  private lockPointer(): void {
    if (!this.mouseLook || this.touchEnabled || this.pointerLocked) return;
    try {
      void Promise.resolve(this.element.requestPointerLock()).catch(() => undefined);
    } catch {
      /* needs a user gesture: the next click on the view locks it */
    }
  }

  private unlockPointer(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  /** Both first-person and shoulder cameras share captured mouse / touch look. */
  setMouseLook(on: boolean): void {
    if (on === this.mouseLook) return;
    this.mouseLook = on;
    this.resetTouch();
    this.touchHeading = null;
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
    this.clearInput();
    this.onActiveChange(false);
  }

  /** Movement axes in screen space (x = screen right, z = screen up / away from camera). */
  axes(): { mx: number; mz: number } {
    if (this.suspended || !this.active) return { mx: 0, mz: 0 };
    const k = this.keys;
    const mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const x = mx + this.touchX, z = mz + this.touchZ;
    const length = Math.max(1, Math.hypot(x, z));
    return { mx: x / length, mz: z / length };
  }

  buttons(): number {
    if (this.suspended || !this.active) return 0;
    let b = this.touchBits | this.touchPresses;
    if (this.keys.has('Space')) b |= Buttons.Jump;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) b |= Buttons.Sprint;
    if (this.mouseButtons & 1) b |= Buttons.Attack;
    if (this.keys.has('KeyC')) b |= Buttons.Roll;
    return b;
  }

  dispose(): void {
    this.clearInput();
    for (const fn of this.cleanup) fn();
  }
}
