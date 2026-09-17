// Gamepad support (Xbox/PlayStation/any controller the browser reports with the W3C "standard"
// button/axis layout). There's no existing "cursor" concept for a controller to drive — powers are
// applied by pointing the mouse/finger at the terrain, and adding a full on-screen reticle plus
// raycast-from-reticle plumbing is a much bigger feature than "add controller support" implies —
// so this covers camera (left stick pans exactly like WASD, right stick looks around, triggers
// zoom) and menu navigation (Start opens/closes the pause menu via the same priority chain Escape
// already uses, D-pad left/right cycles simulation speed).
const DEADZONE = 0.18;

// Standard gamepad mapping (https://www.w3.org/TR/gamepad/#remapping): true for both Xbox and
// PlayStation controllers in Chromium/Edge, which is what this project tests against.
const BUTTON = { A: 0, B: 1, LT: 6, RT: 7, START: 9, DPAD_LEFT: 14, DPAD_RIGHT: 15 };

function applyDeadzone(value, deadzone = DEADZONE) {
  const magnitude = Math.abs(value);
  if (magnitude < deadzone) return 0;
  return Math.sign(value) * (magnitude - deadzone) / (1 - deadzone);
}

// Pure function: raw Gamepad-API state in, a structured intent out. Kept separate from the
// polling/wiring class below so it can be unit-tested with a plain mock object instead of needing
// a real browser Gamepad — see tests/unit/gamepad-input.test.js.
export function readGamepadIntent(gamepad, previousPressed = new Set()) {
  if (!gamepad || gamepad.mapping !== 'standard') return null;
  const axes = gamepad.axes || [];
  const buttons = gamepad.buttons || [];
  const isPressed = index => Boolean(buttons[index]?.pressed);
  const justPressed = index => isPressed(index) && !previousPressed.has(index);
  const nowPressed = new Set();
  for (let i = 0; i < buttons.length; i++) if (isPressed(i)) nowPressed.add(i);

  return {
    moveX: applyDeadzone(axes[0] ?? 0),
    moveY: applyDeadzone(axes[1] ?? 0),
    lookX: applyDeadzone(axes[2] ?? 0),
    lookY: applyDeadzone(axes[3] ?? 0),
    // Positive = "zoom in" (RT/R2, the same trigger that accelerates in a driving game): applied
    // as rig.distance -= zoomDelta * dt * scale, so pressing RT shrinks the distance.
    zoomDelta: (buttons[BUTTON.RT]?.value || 0) - (buttons[BUTTON.LT]?.value || 0),
    confirmJustPressed: justPressed(BUTTON.A),
    backJustPressed: justPressed(BUTTON.B),
    startJustPressed: justPressed(BUTTON.START),
    speedDownJustPressed: justPressed(BUTTON.DPAD_LEFT),
    speedUpJustPressed: justPressed(BUTTON.DPAD_RIGHT),
    nowPressed,
  };
}

export class GamepadInput {
  constructor({ rig, toast = () => {}, onStart = () => {}, onConfirm = () => {}, onBack = () => {}, onSpeedChange = () => {} } = {}) {
    this.rig = rig;
    this.toast = toast;
    this.onStart = onStart;
    this.onConfirm = onConfirm;
    this.onBack = onBack;
    this.onSpeedChange = onSpeedChange;
    this._pressed = new Set();
    this._padIndex = null;
    // Which of rig.keys' WASD entries *this module* last set to true — so a connected-but-idle
    // gamepad (stick centered) never stomps real keyboard input on the same rig.keys object: we
    // only ever release a key we ourselves pressed, never one the keyboard listener is holding.
    this._ownedKeys = { KeyW: false, KeyS: false, KeyA: false, KeyD: false };
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('gamepadconnected', event => {
        if (!event?.gamepad) return;
        this._padIndex = event.gamepad.index;
        this.toast(`🎮 Mando conectado: ${event.gamepad.id}`);
      });
      window.addEventListener('gamepaddisconnected', event => {
        if (!event?.gamepad) return;
        if (this._padIndex === event.gamepad.index) { this._padIndex = null; this._pressed = new Set(); }
        this.toast('🎮 Mando desconectado');
      });
    }
  }

  _activeGamepad() {
    if (typeof navigator?.getGamepads !== 'function') return null;
    const pads = navigator.getGamepads();
    if (this._padIndex != null && pads[this._padIndex]) return pads[this._padIndex];
    for (const pad of pads) if (pad) return pad; // fallback: nothing "connected" yet this session, but one is present
    return null;
  }

  update(dt, { allowCamera = true } = {}) {
    const gamepad = this._activeGamepad();
    if (!gamepad) return;
    const intent = readGamepadIntent(gamepad, this._pressed);
    if (!intent) return;
    this._pressed = intent.nowPressed;

    if (this.rig) {
      const wanted = allowCamera
        ? { KeyW: intent.moveY < 0, KeyS: intent.moveY > 0, KeyA: intent.moveX < 0, KeyD: intent.moveX > 0 }
        : { KeyW: false, KeyS: false, KeyA: false, KeyD: false };
      for (const key of Object.keys(wanted)) {
        // Only ever touch rig.keys[key] when *we* are the one changing it: press it ourselves, or
        // release a press we made earlier. A centered stick with the keyboard driving the same key
        // must leave that key alone rather than force it false.
        if (wanted[key]) { this.rig.keys[key] = true; this._ownedKeys[key] = true; }
        else if (this._ownedKeys[key]) { this.rig.keys[key] = false; this._ownedKeys[key] = false; }
      }
      if (allowCamera && !this.rig.aerial && (intent.lookX || intent.lookY)) {
        this.rig.azimuth -= intent.lookX * dt * 2.4;
        this.rig.polar = Math.min(Math.PI * 0.49, Math.max(0.08, this.rig.polar + intent.lookY * dt * 1.8));
      }
      if (allowCamera && intent.zoomDelta) this.rig.distance = Math.min(this.rig.maxDist, Math.max(this.rig.minDist, this.rig.distance - intent.zoomDelta * dt * 70));
    }

    if (intent.startJustPressed) this.onStart();
    if (intent.confirmJustPressed) this.onConfirm();
    if (intent.backJustPressed) this.onBack();
    if (intent.speedDownJustPressed) this.onSpeedChange(-1);
    if (intent.speedUpJustPressed) this.onSpeedChange(1);
  }
}
