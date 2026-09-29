// Suoni sintetizzati: funzionano senza file audio. In alternativa, nel config usa un file
// messo in public/sounds (es. "sounds/mio-suono.mp3") o un URL completo.
(function () {
  let ctx;
  const audio = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());

  function tone(freq, start, length, volume, type = 'sine') {
    const c = audio();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, c.currentTime + start);
    gain.gain.linearRampToValueAtTime(volume, c.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + length);
    osc.connect(gain).connect(c.destination);
    osc.start(c.currentTime + start);
    osc.stop(c.currentTime + start + length + 0.05);
  }

  const presets = {
    chime: (v) => [659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.6, v)),
    coin: (v) => { tone(988, 0, 0.1, v, 'square'); tone(1319, 0.08, 0.45, v, 'square'); },
    pop: (v) => tone(880, 0, 0.18, v, 'triangle'),
    fanfare: (v) => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.13, i === 5 ? 0.9 : 0.2, v, 'sawtooth')),
  };

  window.playSound = function (sound, volume = 0.5) {
    if (!sound) return;
    if (presets[sound]) {
      presets[sound](Math.min(Math.max(volume, 0), 1) * 0.3);
      return;
    }
    const el = new Audio(sound.startsWith('http') || sound.startsWith('/') ? sound : `/${sound}`);
    el.volume = Math.min(Math.max(volume, 0), 1);
    el.play().catch((err) => console.warn('Audio non riprodotto:', err.message));
  };
})();
