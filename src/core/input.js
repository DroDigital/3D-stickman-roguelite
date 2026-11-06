// Keyboard / mouse / gamepad input with edge-triggered "pressed" queries and input buffering.

const BUFFER_TIME = 0.22;
// Presses worth a longer window: an attack made a beat early, and a spell pressed just before it is ready.
// A dodge is held through its cooldown instead (see hold()).
const BUFFER_TIMES = { attack: 0.3, magic: 0.3, power: 0.3 };

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressedAt = new Map(); // action -> time remaining in buffer
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.locked = false;
    this.sensitivity = 0.0024;
    this.gamepadIndex = -1;
    this.padPrev = {};
    this.padMove = [0, 0];
    this.padLook = [0, 0];
    this.usingPad = false;

    this.bindings = {
      up: ['KeyW', 'ArrowUp'],
      down: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      attack: ['Mouse0', 'KeyJ'],
      arms: ['Mouse2', 'KeyK'],
      magic: ['KeyQ', 'KeyL'],
      power: ['KeyF', 'KeyI'],
      dodge: ['Space'],
      sprint: ['ShiftLeft', 'ShiftRight'],
      lock: ['Tab', 'Mouse1', 'KeyT'],
      lockNext: ['WheelDown', 'KeyC'],
      lockPrev: ['WheelUp', 'KeyZ'],
      interact: ['KeyE'],
      ultimate: ['KeyR'],
      pause: ['Escape', 'KeyP'],
      pick1: ['Digit1'], pick2: ['Digit2'], pick3: ['Digit3'], pick4: ['Digit4'],
      reroll: ['KeyX'],
    };
    this.codeToActions = new Map();
    for (const [action, codes] of Object.entries(this.bindings)) {
      for (const c of codes) {
        if (!this.codeToActions.has(c)) this.codeToActions.set(c, []);
        this.codeToActions.get(c).push(action);
      }
    }

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      this._press(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => {
      this._press('Mouse' + e.button);
      if (!this.locked && this.wantLock) this.requestLock();
    });
    window.addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // the wheel switches lock-on targets
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const code = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
      this._press(code);
      this.down.delete(code);
    }, { passive: false });
    window.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
        this.usingPad = false;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    window.addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    this.wantLock = false;
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* pointer lock unavailable (e.g. headless) */ }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  _press(code) {
    this.down.add(code);
    const acts = this.codeToActions.get(code);
    if (acts) for (const a of acts) this.pressedAt.set(a, BUFFER_TIMES[a] ?? BUFFER_TIME);
    this.usingPad = false;
  }

  _pressAction(a) {
    this.pressedAt.set(a, BUFFER_TIMES[a] ?? BUFFER_TIME);
    this.usingPad = true;
  }

  held(action) {
    const codes = this.bindings[action];
    for (const c of codes) if (this.down.has(c)) return true;
    return !!this.padHeld?.[action];
  }

  /** Buffered press: returns true once if action was pressed within the buffer window. */
  consume(action) {
    if (this.pressedAt.has(action)) {
      this.pressedAt.delete(action);
      return true;
    }
    return false;
  }

  peek(action) { return this.pressedAt.has(action); }

  /** Set the remaining window of a buffered press to `seconds` (real time), e.g. for as long as its cooldown runs. */
  hold(action, seconds) {
    if (this.pressedAt.has(action)) this.pressedAt.set(action, seconds);
  }

  moveAxis(out) {
    let x = 0, y = 0;
    if (this.held('up')) y += 1;
    if (this.held('down')) y -= 1;
    if (this.held('left')) x -= 1;
    if (this.held('right')) x += 1;
    if (Math.abs(this.padMove[0]) + Math.abs(this.padMove[1]) > 0.01) {
      x = this.padMove[0];
      y = this.padMove[1];
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    out[0] = x; out[1] = y;
    return out;
  }

  update(dt) {
    for (const [a, t] of this.pressedAt) {
      const nt = t - dt;
      if (nt <= 0) this.pressedAt.delete(a);
      else this.pressedAt.set(a, nt);
    }
    this._pollPad(dt);
  }

  takeMouse(out) {
    out[0] = this.mouseDX * this.sensitivity + this.padLook[0];
    out[1] = this.mouseDY * this.sensitivity + this.padLook[1];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return out;
  }

  _pollPad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && (pads[this.gamepadIndex] || pads[0]);
    this.padMove[0] = this.padMove[1] = 0;
    this.padLook[0] = this.padLook[1] = 0;
    if (!pad) return;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    this.padMove[0] = dz(pad.axes[0] || 0);
    this.padMove[1] = -dz(pad.axes[1] || 0);
    this.padLook[0] = dz(pad.axes[2] || 0) * 3.2 * dt;
    this.padLook[1] = dz(pad.axes[3] || 0) * 2.4 * dt;
    // A dodge, X blade, Y arms, B arcana, RB power, RT ultimate, LB interact, L3 sprint, R3/LT lock-on
    const map = { 0: 'dodge', 2: 'attack', 3: 'arms', 1: 'magic', 5: 'power', 7: 'ultimate', 4: 'interact', 10: 'sprint', 11: 'lock', 6: 'lock', 9: 'pause', 12: 'pick1', 13: 'pick2', 14: 'pick3', 15: 'pick4', 8: 'reroll' };
    this.padHeld = {};
    for (const [idx, action] of Object.entries(map)) {
      const b = pad.buttons[idx];
      const pressed = b && b.pressed;
      if (pressed) this.padHeld[action] = true;
      if (pressed && !this.padPrev[idx]) this._pressAction(action);
      this.padPrev[idx] = pressed;
    }
  }
}
