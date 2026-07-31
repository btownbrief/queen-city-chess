// QUEEN CITY CHESS — quiet procedural WebAudio cues. No audio files.

const LS_MUTED = 'queen-city-chess-muted';

let context = null;
let master = null;
let muted = localStorage.getItem(LS_MUTED) === '1';

function audioContext() {
  if (!context) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.45;
    master.connect(context.destination);
  }
  if (context.state === 'suspended') context.resume().catch(() => {});
  return context;
}

function tone(frequency, start, duration, {
  type = 'sine',
  gain = 0.07,
  slide = 0,
} = {}) {
  const audio = audioContext();
  if (!audio) return;
  const begins = audio.currentTime + start;
  const ends = begins + duration;
  const oscillator = audio.createOscillator();
  const envelope = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, begins);
  if (slide) {
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(30, frequency + slide),
      ends
    );
  }
  envelope.gain.setValueAtTime(0.0001, begins);
  envelope.gain.exponentialRampToValueAtTime(gain, begins + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, ends);
  oscillator.connect(envelope).connect(master);
  oscillator.addEventListener('ended', () => {
    oscillator.disconnect();
    envelope.disconnect();
  }, { once: true });
  oscillator.start(begins);
  oscillator.stop(ends + 0.02);
}

function play(notes) {
  if (muted) return;
  for (const note of notes) tone(...note);
}

export const sound = {
  get muted() {
    return muted;
  },

  toggleMuted() {
    muted = !muted;
    localStorage.setItem(LS_MUTED, muted ? '1' : '0');
    if (!muted) audioContext();
    return muted;
  },

  unlock() {
    if (!muted) audioContext();
  },

  move() {
    play([
      [190, 0, 0.075, { type: 'triangle', gain: 0.055, slide: -45 }],
      [430, 0, 0.035, { gain: 0.025 }],
    ]);
  },

  capture() {
    play([
      [310, 0, 0.09, { type: 'triangle', gain: 0.075, slide: -115 }],
      [155, 0.055, 0.13, { type: 'sine', gain: 0.09, slide: -45 }],
    ]);
  },

  castle() {
    play([
      [220, 0, 0.09, { type: 'triangle', gain: 0.06, slide: -35 }],
      [294, 0.08, 0.11, { type: 'triangle', gain: 0.06 }],
    ]);
  },

  check() {
    play([
      [392, 0, 0.12, { type: 'triangle', gain: 0.075 }],
      [587, 0.085, 0.17, { type: 'triangle', gain: 0.085 }],
    ]);
  },

  checkmate() {
    play([
      [294, 0, 0.16, { type: 'triangle', gain: 0.075 }],
      [392, 0.12, 0.18, { type: 'triangle', gain: 0.08 }],
      [587, 0.24, 0.26, { type: 'triangle', gain: 0.09 }],
      [784, 0.38, 0.4, { type: 'triangle', gain: 0.075 }],
    ]);
  },

  draw() {
    play([
      [262, 0, 0.22, { type: 'triangle', gain: 0.055 }],
      [294, 0, 0.22, { type: 'triangle', gain: 0.05 }],
    ]);
  },

  resolution(won) {
    const notes = won
      ? [
        [330, 0, 0.15, { type: 'triangle', gain: 0.065 }],
        [440, 0.12, 0.18, { type: 'triangle', gain: 0.07 }],
        [659, 0.25, 0.3, { type: 'triangle', gain: 0.08 }],
      ]
      : [
        [330, 0, 0.18, { type: 'triangle', gain: 0.06 }],
        [247, 0.14, 0.22, { type: 'triangle', gain: 0.065 }],
        [196, 0.29, 0.28, { type: 'triangle', gain: 0.055 }],
      ];
    play(notes);
  },
};
