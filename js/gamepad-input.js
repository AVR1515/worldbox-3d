// Gamepad support (Xbox/PlayStation/any controller the browser reports with the W3C "standard"
// button/axis layout). There's no existing "cursor" concept for a controller to drive — powers are
// applied by pointing the mouse/finger at the terrain, and adding a full on-screen reticle plus
// raycast-from-reticle plumbing is a much bigger feature than "add controller support" implies —
// so this covers camera (left stick pans exactly like WASD, right stick looks around, triggers
// zoom), menu/dialog navigation (D-pad up/down moves focus, A "clicks" it, Start/B mirror Escape),
// simulation speed (D-pad left/right), and — via LB, which toggles "menu mode" for whatever HUD
// root main.js currently reports (the power/tool dock when nothing else is open) — selecting game
// options that live outside a dialog, the same way.

const DEADZONE = 0.18;

// Standard gamepad mapping (https://www.w3.org/TR/gamepad/#remapping): true for both Xbox and
// PlayStation controllers in Chromium/Edge, which is what this project tests against.
const BUTTON = { A: 0, B: 1, LB: 4, LT: 6, RT: 7, START: 9, DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15 };

// Selector for anything a menu/dialog would want the D-pad to be able to land focus on.
// Visibility (offsetParent !== null) is checked separately once elements are pulled out of a
// concrete root, since that requires layout that jsdom/mocks in tests don't always provide.
const FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
    navigateUpJustPressed: justPressed(BUTTON.DPAD_UP),
    navigateDownJustPressed: justPressed(BUTTON.DPAD_DOWN),
    toggleMenuModeJustPressed: justPressed(BUTTON.LB),
    nowPressed,
  };
}

export class GamepadInput {
  // menuRoot(): returns the currently visible menu/dialog element (pause menu, main menu, a side
  // panel, ...) or null/undefined when none is open. While it returns an element, the D-pad drives
  // focus between that element's focusable children instead of the camera, and A "clicks" whichever
  // one is currently focused — the same thing Enter/Space already do for a mouse-and-keyboard user,
  // which a gamepad has no way to trigger on its own since browsers don't turn button presses into
  // clicks.
  constructor({ rig, toast = () => {}, onStart = () => {}, onConfirm = () => {}, onBack = () => {}, onSpeedChange = () => {}, onToggleMenuMode = () => {}, menuRoot = () => null } = {}) {
    this.rig = rig;
    this.toast = toast;
    this.onStart = onStart;
    this.onConfirm = onConfirm;
    this.onBack = onBack;
    this.onSpeedChange = onSpeedChange;
    this.onToggleMenuMode = onToggleMenuMode;
    this.menuRoot = menuRoot;
    this._pressed = new Set();
    this._padIndex = null;
    this._lastMenuRoot = null;
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

  // Elements in `root` a D-pad press can land focus on, in document order (top-to-bottom for
  // every menu/panel in this project's markup), filtered down to what's actually visible right
  // now (display:none collapses offsetParent to null; a plain mock root in tests has neither
  // property, so both checks default to "visible" rather than throwing).
  _focusableIn(root) {
    if (!root?.querySelectorAll) return [];
    return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(el => el.offsetParent !== null || el.offsetParent === undefined);
  }

  _navigateMenu(root, intent) {
    const items = this._focusableIn(root);
    if (!items.length) return;
    const isNewMenu = root !== this._lastMenuRoot;
    this._lastMenuRoot = root;
    const explicitNav = intent.navigateDownJustPressed || intent.navigateUpJustPressed;
    // Auto-focus the first item the moment a menu appears, but only on a frame that isn't itself
    // a D-pad press — otherwise that same press would land on item 0 and then immediately step to
    // item 1, since the code below still runs afterwards.
    if (isNewMenu && !explicitNav && !items.includes(document.activeElement)) items[0].focus();
    const idx = items.indexOf(document.activeElement);
    if (intent.navigateDownJustPressed) items[idx < 0 ? 0 : (idx + 1) % items.length].focus();
    else if (intent.navigateUpJustPressed) items[idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length].focus();
    if (intent.confirmJustPressed && items.includes(document.activeElement)) document.activeElement.click();
  }

  update(dt, { allowCamera = true } = {}) {
    const gamepad = this._activeGamepad();
    if (!gamepad) return;
    const intent = readGamepadIntent(gamepad, this._pressed);
    if (!intent) return;
    this._pressed = intent.nowPressed;

    const menu = this.menuRoot();
    if (menu) {
      this._navigateMenu(menu, intent);
    } else {
      this._lastMenuRoot = null;
    }

    if (!menu && this.rig) {
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
    if (intent.toggleMenuModeJustPressed) this.onToggleMenuMode();
  }
}
