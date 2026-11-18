/**
 * Synthesizes the iconic Netflix "Ta-dum" intro chord using Web Audio API
 */
export function playNetflixTaDum() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const now = ctx.currentTime;

    // Sub-bass thump
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(65.41, now); // C2
    subOsc.frequency.exponentialRampToValueAtTime(32.7, now + 1.2);
    subGain.gain.setValueAtTime(0.5, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 1.4);

    // Deep brassy strings chord (D - A - D - F#)
    const freqs = [73.42, 110.00, 146.83, 185.00, 220.00, 293.66];
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, now + 0.05);

      // Lowpass filter to give that cinematic warm resonance
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300 + idx * 80, now);
      filter.frequency.exponentialRampToValueAtTime(1200, now + 0.3);
      filter.frequency.exponentialRampToValueAtTime(150, now + 2.2);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.18 / (idx + 1), now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + 0.05);
      osc.stop(now + 2.6);
    });

    // Metallic chime tail
    const chimeOsc = ctx.createOscillator();
    const chimeGain = ctx.createGain();
    chimeOsc.type = 'sine';
    chimeOsc.frequency.setValueAtTime(880, now + 0.15); // A5
    chimeOsc.frequency.exponentialRampToValueAtTime(440, now + 2.8);
    chimeGain.gain.setValueAtTime(0.08, now + 0.15);
    chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.8);

    chimeOsc.connect(chimeGain);
    chimeGain.connect(ctx.destination);
    chimeOsc.start(now + 0.15);
    chimeOsc.stop(now + 2.8);
  } catch (err) {
    console.debug('Audio could not be initialized yet:', err);
  }
}
