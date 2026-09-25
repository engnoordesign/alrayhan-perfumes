/* =====================================================================
   Alrayhan — cozy shopping music
   10 original instrumental pieces, composed for the shop and played live
   in the visitor's browser with the Web Audio API. There are no audio
   files to download and no copyright issues: every note is generated
   from the song definitions below (chords, tempo, instruments, mood).

   The visitor starts / stops the music with the ♫ button in the header.
   Songs follow each other in random order, never the same one twice
   in a row.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------- music theory ---------------- */
  const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const QUALITY = {
    '': [0, 4, 7], m: [0, 3, 7], maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14],
    m11: [0, 3, 7, 10, 14, 17], '7': [0, 4, 7, 10], '9': [0, 4, 7, 10, 14], '13': [0, 4, 10, 14, 21], '6': [0, 4, 7, 9],
    m6: [0, 3, 7, 9], '69': [0, 4, 7, 9, 14], sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 14], m7b5: [0, 3, 6, 10]
  };
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11], hijaz: [0, 1, 4, 5, 7, 8, 10], pentatonic: [0, 2, 4, 7, 9]
  };
  function chord(sym) {
    const m = /^([A-G](?:#|b)?)(.*)$/.exec(sym);
    return { root: NOTE[m[1]], ints: QUALITY[m[2]] || QUALITY[''] };
  }
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);

  /* a small seeded random generator, so every song sounds the same each time */
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---------------- the 10 songs ---------------- */
  const SONGS = [
    { ar: 'صباح الورد', en: 'Morning Roses', bpm: 72, key: 'F', scale: 'major', beats: 4,
      prog: ['Fmaj7', 'Em7', 'Dm7', 'Cmaj7', 'Bbmaj7', 'Am7', 'Gm7', 'C9'],
      lead: 'piano', comp: 'piano', bass: true, drums: 'lofi', swing: 0.18, texture: 'crackle', density: 0.6, bars: 48 },
    { ar: 'قهوة الموصل', en: 'Mosul Coffee', bpm: 84, key: 'C', scale: 'dorian', beats: 4,
      prog: ['Dm9', 'G13', 'Cmaj9', 'A7', 'Dm9', 'G13', 'Em7', 'A7'],
      lead: 'rhodes', comp: 'rhodes', bass: true, drums: 'brush', swing: 0.28, texture: null, density: 0.7, bars: 48 },
    { ar: 'عنبر الليل', en: 'Amber Night', bpm: 60, key: 'A', scale: 'minor', beats: 4,
      prog: ['Am9', 'Fmaj7', 'Cmaj7', 'G6'],
      lead: 'piano', comp: 'pad', bass: true, drums: 'none', swing: 0, texture: null, density: 0.45, bars: 36 },
    { ar: 'نسيم الياسمين', en: 'Jasmine Breeze', bpm: 90, key: 'G', scale: 'major', beats: 4,
      prog: ['Gmaj7', 'Bm7', 'Em7', 'Cmaj7', 'Am7', 'D9', 'Gmaj7', 'Cmaj9'],
      lead: 'bell', comp: 'piano', bass: true, drums: 'lofi', swing: 0.12, texture: null, density: 0.55, bars: 56, arp: true },
    { ar: 'خشب الصندل', en: 'Sandalwood', bpm: 76, key: 'Eb', scale: 'major', beats: 4,
      prog: ['Ebmaj7', 'Cm7', 'Fm7', 'Bb7', 'Gm7', 'Cm7', 'Fm9', 'Bb13'],
      lead: 'rhodes', comp: 'rhodes', bass: true, drums: 'lofi', swing: 0.22, texture: 'crackle', density: 0.6, bars: 48 },
    { ar: 'مطر خفيف', en: 'Soft Rain', bpm: 66, key: 'D', scale: 'major', beats: 4,
      prog: ['Dmaj7', 'F#m7', 'Bm7', 'Gmaj7', 'Em9', 'A6', 'Dmaj9', 'Gmaj7'],
      lead: 'piano', comp: 'pad', bass: false, drums: 'none', swing: 0, texture: 'rain', density: 0.5, bars: 40, arp: true },
    { ar: 'مساء دجلة', en: 'Tigris Evening', bpm: 78, key: 'D', scale: 'hijaz', beats: 4,
      prog: ['D', 'D', 'Gm', 'D', 'Cm', 'Gm', 'Eb', 'D'],
      lead: 'pluck', comp: 'pad', bass: true, drums: 'brush', swing: 0.1, texture: null, density: 0.65, bars: 48 },
    { ar: 'ذهب الغروب', en: 'Golden Sunset', bpm: 96, key: 'C', scale: 'major', beats: 3,
      prog: ['Cmaj7', 'Am7', 'Dm7', 'G7', 'Em7', 'A7', 'Dm9', 'G13'],
      lead: 'piano', comp: 'piano', bass: true, drums: 'waltz', swing: 0, texture: null, density: 0.6, bars: 64 },
    { ar: 'وردة المسك', en: 'Musk Rose', bpm: 70, key: 'Bb', scale: 'major', beats: 4,
      prog: ['Bbmaj7', 'Am7', 'Gm7', 'Fmaj7', 'Ebmaj7', 'Dm7', 'Cm9', 'F13'],
      lead: 'rhodes', comp: 'rhodes', bass: true, drums: 'lofi', swing: 0.2, texture: 'crackle', density: 0.5, bars: 44 },
    { ar: 'هدوء', en: 'Calm', bpm: 64, key: 'E', scale: 'lydian', beats: 4,
      prog: ['Emaj7', 'C#m7', 'Amaj9', 'B6', 'Emaj9', 'G#m7', 'Amaj7', 'Bsus4'],
      lead: 'bell', comp: 'pad', bass: false, drums: 'none', swing: 0, texture: null, density: 0.4, bars: 36, arp: true }
  ];

  /* ---------------- sound engine ---------------- */
  function createEngine(ctx, destination) {
    const out = ctx.createGain(); out.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 7500;
    out.connect(warm); warm.connect(comp); comp.connect(destination);

    // soft room reverb from a generated impulse response
    const verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    verb.buffer = ir;
    const verbSend = ctx.createGain(); verbSend.gain.value = 0.32;
    verbSend.connect(verb); verb.connect(out);

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    function voice(gainNode, wet) {
      gainNode.connect(out);
      if (wet) { const s = ctx.createGain(); s.gain.value = wet; gainNode.connect(s); s.connect(verbSend); }
    }
    function env(g, t, a, peak, decayTo, dEnd) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(Math.max(decayTo, 0.0001), dEnd);
    }

    const inst = {
      piano(m, t, d, v) {
        const f = hz(m), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 1800 + v * 3200;
        const end = t + Math.min(d + 1.6, 4);
        env(g, t, 0.006, 0.22 * v, 0.0001, end);
        [[1, 1], [2, 0.32], [3, 0.1], [4, 0.04]].forEach(([k, a]) => {
          const o = ctx.createOscillator(), og = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f * k; o.detune.value = (Math.random() - 0.5) * 4;
          og.gain.value = a; o.connect(og); og.connect(lp); o.start(t); o.stop(end + 0.05);
        });
        lp.connect(g); voice(g, 0.9);
      },
      rhodes(m, t, d, v) {
        const f = hz(m), car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
        car.type = 'sine'; mod.type = 'sine'; car.frequency.value = f; mod.frequency.value = f;
        mg.gain.setValueAtTime(f * (1.6 + v), t); mg.gain.exponentialRampToValueAtTime(f * 0.25, t + 0.7);
        mod.connect(mg); mg.connect(car.frequency); car.connect(g);
        const end = t + Math.min(d + 1.4, 3.6);
        env(g, t, 0.008, 0.2 * v, 0.0001, end);
        car.start(t); mod.start(t); car.stop(end + 0.05); mod.stop(end + 0.05);
        voice(g, 0.7);
      },
      bell(m, t, d, v) {
        const f = hz(m), car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
        car.frequency.value = f; mod.frequency.value = f * 3.5;
        mg.gain.setValueAtTime(f * 1.2, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 1.2);
        mod.connect(mg); mg.connect(car.frequency); car.connect(g);
        const end = t + 2.4;
        env(g, t, 0.004, 0.11 * v, 0.0001, end);
        car.start(t); mod.start(t); car.stop(end + 0.05); mod.stop(end + 0.05);
        voice(g, 1.1);
      },
      pluck(m, t, d, v) {           // oud-like plucked string
        const f = hz(m), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.5);
        const end = t + Math.min(d + 0.9, 2.2);
        env(g, t, 0.003, 0.2 * v, 0.0001, end);
        ['triangle', 'sawtooth'].forEach((type, i) => {
          const o = ctx.createOscillator(), og = ctx.createGain();
          o.type = type; o.frequency.value = f; o.detune.value = i ? 6 : -6; og.gain.value = i ? 0.35 : 0.8;
          o.connect(og); og.connect(lp); o.start(t); o.stop(end + 0.05);
        });
        lp.connect(g); voice(g, 0.8);
      },
      pad(m, t, d, v) {
        const f = hz(m), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05 * v, t + Math.min(0.9, d * 0.4));
        g.gain.setValueAtTime(0.05 * v, t + d);
        g.gain.linearRampToValueAtTime(0.0001, t + d + 0.9);
        [-7, 7].forEach(cents => {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = cents;
          o.connect(lp); o.start(t); o.stop(t + d + 1);
        });
        lp.connect(g); voice(g, 0.9);
      },
      bass(m, t, d, v) {
        const f = hz(m), o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        o.type = 'sine'; o2.type = 'triangle'; o.frequency.value = f; o2.frequency.value = f;
        lp.type = 'lowpass'; lp.frequency.value = 420;
        const o2g = ctx.createGain(); o2g.gain.value = 0.35;
        o.connect(lp); o2.connect(o2g); o2g.connect(lp); lp.connect(g);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.32 * v, t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.1 * v, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.1);
        o.start(t); o2.start(t); o.stop(t + d + 0.15); o2.stop(t + d + 0.15);
        voice(g, 0);
      },
      kick(t, v) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(115, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5 * v, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
        o.connect(g); o.start(t); o.stop(t + 0.4); voice(g, 0);
      },
      noiseHit(t, v, type, freq, q, dur, wet) {
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f); f.connect(g); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02); voice(g, wet);
      },
      snare(t, v) { inst.noiseHit(t, 0.16 * v, 'bandpass', 1900, 0.8, 0.16, 0.4); },
      brush(t, v) { inst.noiseHit(t, 0.07 * v, 'highpass', 3000, 0.5, 0.22, 0.3); },
      hat(t, v) { inst.noiseHit(t, 0.05 * v, 'highpass', 7500, 0.7, 0.045, 0.1); }
    };

    /* background textures: vinyl crackle or soft rain */
    function texture(kind, t, dur) {
      if (!kind) return;
      const len = Math.floor(ctx.sampleRate * 3);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      if (kind === 'crackle') {
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.02 + (Math.random() < 0.0006 ? (Math.random() * 2 - 1) * 0.8 : 0);
      } else {
        let last = 0;
        for (let i = 0; i < len; i++) { last = 0.97 * last + 0.03 * (Math.random() * 2 - 1); d[i] = last * 6; }
      }
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = buf; s.loop = true;
      f.type = kind === 'crackle' ? 'highpass' : 'lowpass'; f.frequency.value = kind === 'crackle' ? 1200 : 1400;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(kind === 'crackle' ? 0.12 : 0.05, t + 2);
      g.gain.setValueAtTime(kind === 'crackle' ? 0.12 : 0.05, t + dur - 2); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.1);
    }

    /* ---------------- composition ---------------- */
    function prepare(song, seed) {
      const R = rng(seed);
      const key = NOTE[song.key];
      const scale = SCALES[song.scale];
      const pool = [];
      for (let m = 62; m <= 86; m++) if (scale.includes(((m - key) % 12 + 12) % 12)) pool.push(m);
      return { song, R, key, scale, pool, lastMel: pool[Math.floor(pool.length / 2)], lastVoicing: null, textureDone: false };
    }

    function voiceChord(st, c) {
      // close voicing between E3 and E4-ish, nearest to the previous chord (smooth voice leading)
      const tones = c.ints.slice(0, 4).map(i => c.root + i);
      let best = null, bestScore = 1e9;
      for (let base = 50; base <= 60; base++) {
        const v = tones.map(t => { let m = base + ((t - base) % 12 + 12) % 12; return m; }).sort((a, b) => a - b);
        const center = v.reduce((a, b) => a + b, 0) / v.length;
        const score = st.lastVoicing ? Math.abs(center - st.lastVoicing) : Math.abs(center - 58);
        if (score < bestScore) { bestScore = score; best = v; }
      }
      st.lastVoicing = best.reduce((a, b) => a + b, 0) / best.length;
      if (c.ints.length > 4) best.push(c.root + c.ints[4] + (c.root + c.ints[4] < best[best.length - 1] ? 12 : 0));
      return best;
    }

    const RHYTHMS4 = [[0, 2, 4, 6], [0, 3, 6], [1, 2, 4], [0, 4, 5], [2, 3, 6], [0, 2, 3, 5], [0, 6], [4, 5, 6], [0, 3, 4, 7]];
    const RHYTHMS3 = [[0, 2, 4], [0, 3, 4], [1, 2, 4], [0, 4], [2, 3, 5]];

    /* schedules one bar starting at time t */
    function scheduleBar(st, bar, t) {
      const s = st.song, R = st.R;
      const beat = 60 / s.bpm, eighth = beat / 2, barDur = beat * s.beats;
      const steps = s.beats * 2;
      const sw = i => (i % 2 ? s.swing * eighth : 0);
      const c = chord(s.prog[bar % s.prog.length]);
      const intro = bar < 4, outro = bar >= s.bars - 2;
      const fade = outro ? 0.55 : 1;

      if (bar === 0 && !st.textureDone) { texture(s.texture, t, (s.bars * barDur)); st.textureDone = true; }

      // chords
      const voicing = voiceChord(st, c);
      if (s.comp === 'pad') {
        voicing.forEach(m => inst.pad(m, t, barDur * 0.98, 0.9 * fade));
      } else if (s.arp) {
        voicing.concat([voicing[0] + 12]).forEach((m, i) => {
          const at = t + i * eighth + sw(i);
          if (i < steps) inst[s.comp](m, at, eighth * 2, (0.45 + R() * 0.15) * fade);
        });
      } else if (s.comp === 'rhodes') {
        [0, 3, 6].filter(i => i < steps).forEach((i, k) => voicing.forEach(m => inst.rhodes(m, t + i * eighth + sw(i), k ? eighth * 2 : eighth * 3, (k ? 0.45 : 0.6) * fade)));
      } else {
        voicing.forEach(m => inst.piano(m, t + R() * 0.012, barDur * 0.9, 0.55 * fade));
        if (s.beats === 3) [2, 4].forEach(i => voicing.slice(1).forEach(m => inst.piano(m, t + i * eighth, eighth * 2, 0.32 * fade)));
        else voicing.forEach(m => inst.piano(m, t + 4 * eighth + sw(4), eighth * 3, 0.35 * fade));
      }

      // bass
      if (s.bass) {
        const root = 36 + ((c.root % 12) + 12) % 12;
        inst.bass(root, t, beat * (s.beats === 3 ? 1.8 : 2) * 0.95, 0.9 * fade);
        const fifth = root + (c.ints.includes(7) ? 7 : c.ints[2] || 7);
        if (s.beats === 4) inst.bass(R() < 0.5 ? fifth : root + 12, t + beat * 2 + sw(4), beat * 1.6, 0.75 * fade);
      }

      // drums
      if (!intro && !outro && s.drums !== 'none') {
        for (let i = 0; i < steps; i++) {
          const at = t + i * eighth + sw(i);
          if (s.drums === 'lofi') {
            if (i === 0 || (i === 5 && R() < 0.7)) inst.kick(at, 0.9);
            if (i === 2 || i === 6) inst.snare(at, 0.8);
            inst.hat(at, i % 2 ? 0.55 : 0.8);
          } else if (s.drums === 'brush') {
            if (i === 0) inst.kick(at, 0.6);
            if (i % 2 === 0) inst.brush(at, i === 2 || i === 6 ? 1 : 0.6);
            else if (R() < 0.4) inst.brush(at, 0.4);
          } else if (s.drums === 'waltz') {
            if (i === 0) inst.kick(at, 0.7);
            if (i === 2 || i === 4) inst.brush(at, 0.8);
          }
        }
      }

      // melody
      if (!intro && bar < s.bars - 1) {
        const phrasePos = (bar - 4) % 4;
        const rest = R() > s.density + (phrasePos === 3 ? -0.2 : 0.15);
        if (!rest) {
          const shapes = s.beats === 3 ? RHYTHMS3 : RHYTHMS4;
          let onsets = shapes[Math.floor(R() * shapes.length)].filter(i => i < steps);
          if (phrasePos === 3) onsets = onsets.slice(0, 2);
          const chordPcs = c.ints.map(i => (c.root + i) % 12);
          onsets.forEach((i, k) => {
            const next = k + 1 < onsets.length ? onsets[k + 1] : steps + (phrasePos === 3 ? 2 : 0);
            // move by small steps through the scale; land on chord tones on strong beats
            let idx = st.pool.indexOf(st.lastMel);
            if (idx < 0) idx = Math.floor(st.pool.length / 2);
            const r = R(), step = r < 0.35 ? 1 : r < 0.7 ? -1 : r < 0.85 ? 2 : -2;
            idx = Math.max(3, Math.min(st.pool.length - 4, idx + step));
            let m = st.pool[idx];
            if (i % 2 === 0 || k === onsets.length - 1) {
              for (let dd = 0; dd < 3; dd++) {
                if (chordPcs.includes(((m % 12) + 12) % 12)) break;
                const up = st.pool[Math.min(st.pool.length - 1, st.pool.indexOf(m) + 1)];
                m = up;
              }
            }
            st.lastMel = m;
            const dur = (next - i) * eighth * 0.95;
            inst[s.lead](m, t + i * eighth + sw(i), dur, (0.62 + R() * 0.2) * fade);
          });
        }
      }
      return barDur;
    }

    return { out, prepare, scheduleBar };
  }

  /* ---------------- player ---------------- */
  const btn = document.getElementById('musicToggleBtn');
  const AC = window.AudioContext || window.webkitAudioContext;
  window.AlrayhanMusic = { SONGS, createEngine };           // used by tests
  if (!btn) return;
  if (!AC) { btn.hidden = true; return; }

  const VOLUME = 0.55;
  let ctx = null, master = null, engine = null, timer = null, playing = false;
  let order = [], st = null, bar = 0, nextBarTime = 0, songCount = 0, current = -1;

  function shuffled() {
    const a = SONGS.map((_, i) => i);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    if (a[0] === current && a.length > 1) [a[0], a[1]] = [a[1], a[0]];   // never the same song twice in a row
    return a;
  }
  function nextSong() {
    if (!order.length) order = shuffled();
    current = order.shift();
    st = engine.prepare(SONGS[current], 1000 + current * 97 + (songCount++) * 7);
    bar = 0;
    const startIn = Math.max(0, (nextBarTime - ctx.currentTime) * 1000);
    setTimeout(() => { if (playing) announce(SONGS[current]); }, startIn);
  }

  const toast = document.createElement('div');
  toast.className = 'music-toast';
  toast.setAttribute('role', 'status');
  document.body.appendChild(toast);
  let toastTimer = 0;
  function announce(song) {
    toast.innerHTML = '<span class="mt-note">♫</span> <b></b><small></small>';
    toast.querySelector('b').textContent = song.ar;
    toast.querySelector('small').textContent = song.en;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
    btn.title = 'موسيقى: ' + song.ar + ' — اضغط للإيقاف';
  }

  function tick() {
    // schedule 2 seconds ahead so the music keeps flowing even in a background tab
    while (nextBarTime < ctx.currentTime + 2) {
      if (bar >= st.song.bars) { nextBarTime += 60 / st.song.bpm * 2; nextSong(); continue; }
      nextBarTime += engine.scheduleBar(st, bar, nextBarTime);
      bar++;
    }
  }

  function start() {
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.0001; master.connect(ctx.destination);
    }
    if (!engine) engine = createEngine(ctx, master);
    ctx.resume();
    playing = true;
    if (!st) { nextBarTime = ctx.currentTime + 0.15; nextSong(); }
    else { nextBarTime = Math.max(nextBarTime, ctx.currentTime + 0.15); announce(SONGS[current]); }
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), ctx.currentTime);
    master.gain.linearRampToValueAtTime(VOLUME, ctx.currentTime + 1.2);
    tick();
    timer = setInterval(tick, 250);
    setUi(true);
  }

  function stop() {
    playing = false;
    clearInterval(timer);
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0.0001, now + 0.6);
    // notes already scheduled would play after resume: drop them with the old engine and start fresh
    setTimeout(() => { if (!playing) { ctx.suspend(); st = null; try { engine.out.disconnect(); } catch (e) {} engine = null; } }, 700);
    toast.classList.remove('show');
    setUi(false);
  }

  function setUi(on) {
    btn.classList.toggle('playing', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'إيقاف الموسيقى' : 'تشغيل موسيقى هادئة');
    if (!on) btn.title = 'تشغيل موسيقى هادئة';
  }

  btn.addEventListener('click', () => (playing ? stop() : start()));
})();
