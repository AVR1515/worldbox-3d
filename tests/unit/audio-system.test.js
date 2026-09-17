import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioSystem } from '../../js/audio-system.js';
import { EventBus } from '../../js/core/event-bus.js';

afterEach(() => vi.unstubAllGlobals());
describe('audio', () => {
  it('no crea audio desactivado, desbloquea al interactuar y limita ráfagas', () => {
    const oscillator = { frequency: { setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() };
    oscillator.connect.mockReturnValue(gain);
    const context = { state: 'running', currentTime: 1, createOscillator: () => oscillator, createGain: () => gain, suspend: vi.fn(), close: vi.fn() };
    const constructor = vi.fn(function () { return context; });
    vi.stubGlobal('AudioContext', constructor);
    const audio = new AudioSystem({ enabled: false });
    audio.action('create'); expect(constructor).not.toHaveBeenCalled();
    audio.setEnabled(true); audio.action('create'); audio.action('create');
    expect(oscillator.start).toHaveBeenCalledTimes(1);
    expect(oscillator.stop).toHaveBeenCalledWith(1.07);
    audio.setEnabled(false); expect(context.suspend).toHaveBeenCalledOnce();
    audio.dispose(); expect(context.close).toHaveBeenCalledOnce();
  });
  it('reconectar y destruir no deja suscripciones duplicadas', () => {
    const events = new EventBus(), audio = new AudioSystem();
    audio.action = vi.fn();
    audio.attach(events); audio.attach(events);
    events.emit('creature:spawned', {});
    expect(audio.action).toHaveBeenCalledTimes(1);
    audio.dispose(); events.emit('creature:spawned', {});
    expect(audio.action).toHaveBeenCalledTimes(1);
  });
});
