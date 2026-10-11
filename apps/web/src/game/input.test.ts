import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buttons } from '@zion/shared';
import { InputController } from './input';

const controllers: InputController[] = [];
afterEach(() => { for (const input of controllers.splice(0)) input.dispose(); vi.unstubAllGlobals(); });
function setup() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false, pointerLockElement: null, exitPointerLock: vi.fn() });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
  const element = Object.assign(new EventTarget(), {
    style: {}, requestPointerLock: vi.fn(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 800 }),
  });
  const input = new InputController(element as unknown as HTMLElement, {
    openChat: vi.fn(), activeChange: vi.fn(), openInventory: vi.fn(), hotbar: vi.fn(), cycleHotbar: vi.fn(), reload: vi.fn(), heal: vi.fn(),
  });
  controllers.push(input);
  input.setTouchEnabled(true); input.requestLock();
  return { input, win, doc, element };
}
describe('mobile input', () => {
  it('faces movement in top view and gives the fire stick priority until released', () => {
    const { input } = setup();
    const cameraYaw = Math.PI / 4;
    input.touchMove(0, 1);
    expect(input.touchFacing(cameraYaw)).toBeCloseTo(cameraYaw);
    input.touchMove(1, 0);
    expect(input.touchFacing(cameraYaw)).toBeCloseTo(-Math.PI / 4);
    input.touchFireDirection(0, -1, cameraYaw);
    expect(input.touchFacing(cameraYaw)).toBeCloseTo(cameraYaw);
    input.touchMove(-1, 0);
    expect(input.touchFacing(cameraYaw)).toBeCloseTo(cameraYaw);
    input.touchFireDirection(0, 0, cameraYaw);
    expect(input.touchFacing(cameraYaw)).toBeCloseTo(3 * Math.PI / 4);
    input.touchMove(0, 0);
    expect(input.touchFacing(cameraYaw)).toBeCloseTo(3 * Math.PI / 4);
  });

  it('releases fire-stick priority on reset and keeps first-person facing independent of movement', () => {
    const { input } = setup();
    input.touchFireDirection(1, 0, 0);
    input.resetTouch();
    expect(input.touchFireActive).toBe(false);
    input.touchMove(0, 1);
    expect(input.touchFacing(0)).toBeCloseTo(0);
    input.setMouseLook(true);
    input.yaw = .7;
    input.touchMove(1, 0);
    expect(input.touchFacing(0)).toBeCloseTo(.7);
  });

  it('aims the right stick relative to the camera and fires until released', () => {
    const { input } = setup();
    input.touchMove(0, 1);
    input.touchFireDirection(1, 0, Math.PI / 4);
    expect(input.touchHeading).toBeCloseTo(-Math.PI / 4);
    expect(input.buttons() & Buttons.Attack).toBe(Buttons.Attack);
    input.acknowledgeTouchPresses();
    input.touchFireDirection(0, 0, Math.PI / 4);
    expect(input.buttons() & Buttons.Attack).toBe(0);
    expect(input.touchHeading).toBeCloseTo(-Math.PI / 4);
    expect(input.axes().mz).toBe(1);
    input.touchFireDirection(0, -1, Math.PI / 4);
    expect(input.touchHeading).toBeCloseTo(Math.PI / 4);
  });
  it('clears firing when switching views and ignores the fire stick in first person', () => {
    const { input } = setup();
    input.touchFireDirection(1, 0, 0);
    input.setMouseLook(true);
    expect(input.buttons()).toBe(0);
    expect(input.touchHeading).toBeNull();
    input.touchFireDirection(1, 0, 0);
    expect(input.buttons()).toBe(0);
  });
  it('combines joystick, firing, sprint and scope without one finger releasing another action', () => {
    const { input } = setup();
    input.touchMove(1, 1); input.touchButton('attack', true); input.touchButton('aim', true); input.touchButton('sprint', true);
    expect(input.axes().mx).toBeCloseTo(Math.SQRT1_2);
    expect(input.axes().mz).toBeCloseTo(Math.SQRT1_2);
    expect(input.buttons()).toBe(Buttons.Attack | Buttons.Sprint);
    expect(input.aiming).toBe(true);
    input.acknowledgeTouchPresses(); input.touchButton('attack', false);
    expect(input.buttons()).toBe(Buttons.Sprint);
    expect(input.aiming).toBe(true);
    expect(input.axes().mz).toBeGreaterThan(0);
  });
  it('preserves a quick roll tap until a simulation input has consumed it', () => {
    const { input } = setup();
    input.touchButton('roll', true); input.touchButton('roll', false);
    expect(input.buttons() & Buttons.Roll).toBe(Buttons.Roll);
    input.acknowledgeTouchPresses();
    expect(input.buttons() & Buttons.Roll).toBe(0);
  });
  it.each(['suspend', 'pause', 'blur', 'hidden', 'resize', 'disable', 'dialogue'])('releases held touches on %s', (reason) => {
    const { input, win, doc } = setup();
    input.touchMove(0, 1); input.touchButton('attack', true); input.touchButton('aim', true);
    if (reason === 'suspend') { input.suspended = true; input.suspended = false; }
    if (reason === 'pause') { input.release(); input.requestLock(); }
    if (reason === 'blur') win.dispatchEvent(new Event('blur'));
    if (reason === 'hidden') { doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); }
    if (reason === 'resize') win.dispatchEvent(new Event('resize'));
    if (reason === 'disable') { input.setTouchEnabled(false); input.setTouchEnabled(true); }
    if (reason === 'dialogue') { input.freeCursor = true; input.freeCursor = false; }
    expect(input.axes()).toEqual({ mx: 0, mz: 0 }); expect(input.buttons()).toBe(0); expect(input.aiming).toBe(false);
  });
  it('wraps first-person yaw, clamps pitch and never requests pointer lock in touch mode', () => {
    const { input, element } = setup();
    input.setMouseLook(true); input.touchLook(100000, -100000);
    expect(input.yaw).toBeGreaterThanOrEqual(-Math.PI); expect(input.yaw).toBeLessThan(Math.PI);
    expect(input.pitch).toBe(1.4); expect(element.requestPointerLock).not.toHaveBeenCalled();
    input.touchLook(0, 100000); expect(input.pitch).toBe(-1.4);
  });
  it('scales mouse and touch aiming with optical zoom and restores normal look on zoom-out', () => {
    const { input, win, doc, element } = setup();
    input.setMouseLook(true);
    input.lookScale = 1 / 8;
    input.touchLook(80, 40);
    expect(input.yaw).toBeCloseTo(-.025);
    expect(input.pitch).toBeCloseTo(-.0125);
    input.setTouchEnabled(false);
    Object.assign(doc, { pointerLockElement: element });
    const move = () => win.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 80, movementY: 40, clientX: 200, clientY: 400 }));
    move();
    expect(input.yaw).toBeCloseTo(-.035);
    expect(input.pitch).toBeCloseTo(-.0175);
    input.lookScale = 1;
    move();
    expect(input.yaw).toBeCloseTo(-.115);
    expect(input.pitch).toBeCloseTo(-.0575);
  });
  it('moves the top-down aim cursor with a swipe and clamps it to the viewport', () => {
    const { input } = setup();
    input.touchLook(100, 100);
    expect(input.pointer.x).toBeCloseTo(0.5); expect(input.pointer.y).toBeCloseTo(0.1);
    input.touchLook(10000, 10000);
    expect(input.pointer).toEqual({ x: 0.95, y: -0.95 });
  });
  it('ignores disabled, suspended and non-finite touch input', () => {
    const { input } = setup();
    input.touchMove(NaN, 1); input.touchLook(Infinity, 0);
    expect(input.axes()).toEqual({ mx: 0, mz: 0 });
    input.suspended = true; input.touchMove(1, 1); input.touchButton('attack', true);
    input.suspended = false; expect(input.buttons()).toBe(0);
    input.setTouchEnabled(false); input.touchMove(1, 1); input.touchButton('attack', true);
    expect(input.axes()).toEqual({ mx: 0, mz: 0 }); expect(input.buttons()).toBe(0);
  });
});
