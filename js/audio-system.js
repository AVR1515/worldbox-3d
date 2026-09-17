export class AudioSystem {
  constructor({ enabled = true } = {}) {
    this.enabled = enabled;
    this.context = null;
    this.lastPlayed = 0;
    this.unsubscribers = [];
  }

  unlock() {
    if (!this.enabled) return;
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContext) return;
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled && this.context?.state === 'running') void this.context.suspend();
    else if (this.enabled && this.context) this.unlock();
  }

  tone(frequency = 440, duration = 0.08, volume = 0.035, type = 'sine') {
    if (!this.enabled) return;
    this.unlock();
    if (!this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (now - this.lastPlayed < 0.035) return;
    this.lastPlayed = now;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  action(kind) {
    const sounds = {
      create: [520, 0.07, 0.025, 'sine'], heal: [680, 0.16, 0.03, 'sine'],
      danger: [95, 0.28, 0.06, 'sawtooth'], click: [310, 0.045, 0.018, 'square'],
      save: [740, 0.11, 0.025, 'sine'], war: [145, 0.2, 0.045, 'square'],
    };
    this.tone(...(sounds[kind] || sounds.click));
  }

  attach(events) {
    this.detach();
    if (!events?.on) return;
    this.unsubscribers.push(events.on('creature:spawned', () => this.action('create')));
    this.unsubscribers.push(events.on('cataclysm:detonation', () => this.action('danger')));
    this.unsubscribers.push(events.on('cataclysm:earthquake', () => this.action('danger')));
    this.unsubscribers.push(events.on('status:applied', ({ type } = {}) => this.action(type === 'blessed' ? 'heal' : 'click')));
  }

  detach() { for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe(); }
  dispose() { this.detach(); void this.context?.close?.(); this.context = null; }
}
