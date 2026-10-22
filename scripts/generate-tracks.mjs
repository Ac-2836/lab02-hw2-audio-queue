// Generates original, royalty-free demo tracks (no downloads, no samples).
// Usage: node scripts/generate-tracks.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 22050;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'public', 'audio');
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Additive voice: fundamental plus decaying harmonics, attack/release envelope.
function note(buf, start, dur, freq, amp, harmonics) {
  const i0 = Math.floor(start * RATE);
  const n = Math.floor(dur * RATE);
  const atk = Math.min(0.01 * RATE, n / 4);
  for (let i = 0; i < n && i0 + i < buf.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, i / atk) * Math.min(1, (n - i) / (0.05 * RATE));
    let s = 0;
    for (let h = 1; h <= harmonics; h++) {
      if (freq * h < RATE / 2) s += Math.sin(2 * Math.PI * freq * h * t) / h;
    }
    buf[i0 + i] += s * env * amp;
  }
}

function toWav(buf) {
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const fade = Math.floor(0.2 * RATE);
  const data = Buffer.alloc(buf.length * 2);
  buf.forEach((v, i) => {
    const f = Math.min(1, i / fade, (buf.length - i) / fade);
    const s = Math.round((v / peak) * 0.8 * f * 32767);
    data.writeInt16LE(s, i * 2);
  });
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const track = (secs) => new Float32Array(secs * RATE);

// 1. A-minor arpeggio, fast, rising and falling through three octaves.
function arpeggio() {
  const b = track(10);
  const seq = [57, 60, 64, 69, 72, 76, 81, 76, 72, 69, 64, 60];
  for (let k = 0; k * 0.2 < 10; k++) {
    note(b, k * 0.2, 0.28, midi(seq[k % seq.length]), 1, 4);
  }
  return b;
}

// 2. Slow chord pads (Am - F - C - G) with a soft bass.
function pads() {
  const b = track(12);
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  chords.forEach((c, i) => {
    c.forEach((n) => note(b, i * 3, 3.1, midi(n), 0.6, 6));
    note(b, i * 3, 3.1, midi(c[0] - 24), 0.9, 3);
  });
  return b;
}

// 3. Bass pulse with a bright high melody: energy at both spectrum ends.
function pulse() {
  const b = track(10);
  const bass = [33, 33, 36, 31];
  for (let k = 0; k < 20; k++) {
    note(b, k * 0.5, 0.25, midi(bass[k % 4]), 1, 5);
  }
  const mel = [81, 84, 88, 84, 86, 83, 79, 83];
  for (let k = 0; k < 20; k++) {
    note(b, k * 0.5 + 0.25, 0.2, midi(mel[k % mel.length]), 0.5, 2);
  }
  return b;
}

// 4. Rising glissando over a drone: sweeps through every analyser bin.
function sweep() {
  const b = track(9);
  const n = b.length;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = 150 * 2 ** ((i / n) * 5); // 150 Hz -> ~4.8 kHz
    phase += (2 * Math.PI * f) / RATE;
    b[i] += Math.sin(phase) * 0.7;
  }
  [45, 52, 57].forEach((m) => note(b, 0, 9, midi(m), 0.4, 3));
  return b;
}

mkdirSync(OUT, { recursive: true });
const tracks = {
  'arpeggio.wav': arpeggio,
  'pads.wav': pads,
  'pulse.wav': pulse,
  'sweep.wav': sweep,
};
for (const [name, make] of Object.entries(tracks)) {
  const wav = toWav(make());
  writeFileSync(join(OUT, name), wav);
  console.log(`${name}: ${wav.length} bytes`);
}
