/* =====================================================================
   Alrayhan — soft boutique background music
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

  /* ---------------- the 10 songs ----------------
     Soft "boutique" background music: warm piano, electric piano and
     vibraphone over gentle bossa / lounge grooves. No drum kits, no
     noise textures — only a quiet shaker or brush so it stays behind
     the conversation and never distracts from shopping. */
  const SONGS = [
    { ar: 'بوتيك الورد', en: 'Rose Boutique', bpm: 92, key: 'F', scale: 'major', beats: 4,
      prog: ['Fmaj7', 'Gm7', 'Am7', 'Bbmaj7', 'Gm7', 'C9', 'Fmaj7', 'D7'],
      lead: 'piano', comp: 'rhodes', groove: 'bossa', bass: 'bossa', swing: 0, density: 0.6, bars: 48 },
    { ar: 'عطر الصباح', en: 'Morning Scent', bpm: 84, key: 'G', scale: 'major', beats: 4,
      prog: ['Gmaj7', 'Cmaj7', 'Am7', 'D9', 'Bm7', 'Em7', 'Am9', 'D13'],
      lead: 'rhodes', comp: 'pad', groove: 'shaker', bass: 'walk', swing: 0.12, density: 0.55, bars: 44 },
    { ar: 'مسك وعنبر', en: 'Musk & Amber', bpm: 76, key: 'D', scale: 'major', beats: 4,
      prog: ['Dmaj9', 'Bm7', 'Em9', 'A13', 'F#m7', 'Bm7', 'Gmaj7', 'A6'],
      lead: 'piano', comp: 'piano', groove: 'brush', bass: 'soft', swing: 0.2, density: 0.55, bars: 40 },
    { ar: 'نسمة ياسمين', en: 'Jasmine Air', bpm: 88, key: 'C', scale: 'major', beats: 4,
      prog: ['Cmaj7', 'Am7', 'Dm7', 'G13', 'Em7', 'A7', 'Dm9', 'G9'],
      lead: 'vibes', comp: 'rhodes', groove: 'bossa', bass: 'bossa', swing: 0, density: 0.55, bars: 48 },
    { ar: 'خشب العود', en: 'Oud Wood', bpm: 80, key: 'D', scale: 'hijaz', beats: 4,
      prog: ['D', 'Gm', 'D', 'Cm', 'Gm', 'Eb', 'Cm', 'D'],
      lead: 'pluck', comp: 'pad', groove: 'brush', bass: 'soft', swing: 0.08, density: 0.55, bars: 40 },
    { ar: 'زهر البرتقال', en: 'Orange Blossom', bpm: 96, key: 'Bb', scale: 'major', beats: 4,
      prog: ['Bbmaj7', 'Gm7', 'Cm7', 'F9', 'Dm7', 'Gm7', 'Cm9', 'F13'],
      lead: 'piano', comp: 'rhodes', groove: 'bossa', bass: 'bossa', swing: 0, density: 0.6, bars: 52 },
    { ar: 'حرير', en: 'Silk', bpm: 72, key: 'Eb', scale: 'major', beats: 4,
      prog: ['Ebmaj7', 'Abmaj7', 'Fm9', 'Bb13'],
      lead: 'rhodes', comp: 'pad', groove: 'none', bass: 'soft', swing: 0.15, density: 0.5, bars: 36 },
    { ar: 'ضوء ذهبي', en: 'Golden Light', bpm: 90, key: 'C', scale: 'major', beats: 3,
      prog: ['Cmaj7', 'Am7', 'Dm7', 'G7', 'Em7', 'A7', 'Dm9', 'G13'],
      lead: 'piano', comp: 'piano', groove: 'waltz', bass: 'soft', swing: 0, density: 0.55, bars: 56 },
    { ar: 'لافندر', en: 'Lavender', bpm: 82, key: 'A', scale: 'major', beats: 4,
      prog: ['Amaj7', 'F#m7', 'Bm9', 'E13', 'C#m7', 'F#m7', 'Dmaj7', 'E6'],
      lead: 'vibes', comp: 'piano', groove: 'shaker', bass: 'walk', swing: 0.14, density: 0.5, bars: 44 },
    { ar: 'هدوء المساء', en: 'Quiet Evening', bpm: 70, key: 'E', scale: 'major', beats: 4,
      prog: ['Emaj9', 'C#m7', 'Amaj7', 'B6', 'G#m7', 'C#m9', 'Amaj9', 'Bsus4'],
      lead: 'piano', comp: 'pad', groove: 'none', bass: 'soft', swing: 0, density: 0.45, bars: 36 }
  ];

  /* ---------------- sound engine ---------------- */
  function createEngine(ctx, destination) {
    const out = ctx.createGain(); out.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.3;
    const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 5200;   // soft, warm top end
    out.connect(warm); warm.connect(comp); comp.connect(destination);

    // soft room reverb from a generated impulse response
    const verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    verb.buffer = ir;
    const verbSend = ctx.createGain(); verbSend.gain.value = 0.28;
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
        lp.type = 'lowpass'; lp.frequency.value = 1300 + v * 1800;
        const end = t + Math.min(d + 1.4, 3.6);
        env(g, t, 0.01, 0.17 * v, 0.0001, end);
        [[1, 1], [2, 0.26], [3, 0.07], [4, 0.025]].forEach(([k, a]) => {
          const o = ctx.createOscillator(), og = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f * k; o.detune.value = (Math.random() - 0.5) * 4;
          og.gain.value = a; o.connect(og); og.connect(lp); o.start(t); o.stop(end + 0.05);
        });
        lp.connect(g); voice(g, 0.8);
      },
      rhodes(m, t, d, v) {
        const f = hz(m), car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
        car.type = 'sine'; mod.type = 'sine'; car.frequency.value = f; mod.frequency.value = f;
        mg.gain.setValueAtTime(f * (0.9 + v * 0.6), t); mg.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.6);
        mod.connect(mg); mg.connect(car.frequency); car.connect(g);
        const end = t + Math.min(d + 1.2, 3.2);
        env(g, t, 0.012, 0.16 * v, 0.0001, end);
        car.start(t); mod.start(t); car.stop(end + 0.05); mod.stop(end + 0.05);
        voice(g, 0.6);
      },
      vibes(m, t, d, v) {           // vibraphone: pure tone with a slow shimmer
        const f = hz(m), g = ctx.createGain(), trem = ctx.createGain(), lfo = ctx.createOscillator(), lfoG = ctx.createGain();
        const end = t + Math.min(d + 1.6, 3.4);
        env(g, t, 0.006, 0.13 * v, 0.0001, end);
        trem.gain.value = 0.85; lfo.frequency.value = 5.2; lfoG.gain.value = 0.15;
        lfo.connect(lfoG); lfoG.connect(trem.gain);
        [[1, 1], [4, 0.06]].forEach(([k, a]) => {
          const o = ctx.createOscillator(), og = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f * k; og.gain.value = a;
          o.connect(og); og.connect(trem); o.start(t); o.stop(end + 0.05);
        });
        trem.connect(g); lfo.start(t); lfo.stop(end + 0.05);
        voice(g, 0.9);
      },
      pluck(m, t, d, v) {           // soft oud-like plucked string
        const f = hz(m), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.Q.value = 1.2;
        lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(450, t + 0.45);
        const end = t + Math.min(d + 0.8, 2);
        env(g, t, 0.004, 0.15 * v, 0.0001, end);
        ['triangle', 'sawtooth'].forEach((type, i) => {
          const o = ctx.createOscillator(), og = ctx.createGain();
          o.type = type; o.frequency.value = f; o.detune.value = i ? 5 : -5; og.gain.value = i ? 0.22 : 0.85;
          o.connect(og); og.connect(lp); o.start(t); o.stop(end + 0.05);
        });
        lp.connect(g); voice(g, 0.8);
      },
      pad(m, t, d, v) {
        const f = hz(m), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 750; lp.Q.value = 0.3;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035 * v, t + Math.min(1, d * 0.4));
        g.gain.setValueAtTime(0.035 * v, t + d);
        g.gain.linearRampToValueAtTime(0.0001, t + d + 1);
        [['sawtooth', -6], ['triangle', 6]].forEach(([type, cents]) => {
          const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = cents;
          o.connect(lp); o.start(t); o.stop(t + d + 1.1);
        });
        lp.connect(g); voice(g, 0.9);
      },
      bass(m, t, d, v) {           // round upright-style bass
        const f = hz(m), o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
        o.type = 'sine'; o2.type = 'triangle'; o.frequency.value = f; o2.frequency.value = f;
        lp.type = 'lowpass'; lp.frequency.value = 360;
        const o2g = ctx.createGain(); o2g.gain.value = 0.25;
        o.connect(lp); o2.connect(o2g); o2g.connect(lp); lp.connect(g);
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.22 * v, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.08 * v, t + 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.1);
        o.start(t); o2.start(t); o.stop(t + d + 0.15); o2.stop(t + d + 0.15);
        voice(g, 0);
      },
      noiseHit(t, v, type, freq, q, dur, wet) {
        const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        s.buffer = noise; f.type = type; f.frequency.value = freq; f.Q.value = q;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(f); f.connect(g); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02); voice(g, wet);
      },
      shaker(t, v) { inst.noiseHit(t, 0.022 * v, 'bandpass', 6200, 1.1, 0.07, 0.15); },
      brush(t, v) { inst.noiseHit(t, 0.03 * v, 'highpass', 2800, 0.5, 0.2, 0.25); },
      rim(t, v) { inst.noiseHit(t, 0.03 * v, 'bandpass', 1500, 4, 0.035, 0.3); }
    };

    /* ---------------- composition ---------------- */
    function prepare(song, seed) {
      const R = rng(seed);
      const key = NOTE[song.key];
      const scale = SCALES[song.scale];
      const pool = [];
      for (let m = 60; m <= 81; m++) if (scale.includes(((m - key) % 12 + 12) % 12)) pool.push(m);
      // the melody repeats like a real song: A A B A over the chord cycle
      const cycle = song.prog.length >= 8 ? song.prog.length : song.prog.length * 2;
      return { song, R, key, scale, pool, cycle, motifs: {}, lastMel: pool[Math.floor(pool.length / 2)], lastVoicing: null };
    }

    function voiceChord(st, c) {
      // close voicing around middle C, nearest to the previous chord (smooth voice leading)
      const tones = c.ints.slice(0, 4).map(i => c.root + i);
      let best = null, bestScore = 1e9;
      for (let base = 50; base <= 60; base++) {
        const v = tones.map(t => base + ((t - base) % 12 + 12) % 12).sort((a, b) => a - b);
        const center = v.reduce((a, b) => a + b, 0) / v.length;
        const score = st.lastVoicing ? Math.abs(center - st.lastVoicing) : Math.abs(center - 57);
        if (score < bestScore) { bestScore = score; best = v; }
      }
      st.lastVoicing = best.reduce((a, b) => a + b, 0) / best.length;
      if (c.ints.length > 4) best.push(c.root + c.ints[4] + (c.root + c.ints[4] < best[best.length - 1] ? 12 : 0));
      return best;
    }

    const RHYTHMS4 = [[0, 2, 4, 6], [0, 3, 6], [1, 2, 4], [0, 4, 5], [2, 3, 6], [0, 2, 3, 5], [0, 6], [0, 4], [0, 3, 4]];
    const RHYTHMS3 = [[0, 2, 4], [0, 3, 4], [1, 2, 4], [0, 4], [0, 2]];
    const FORM = ['A', 'A', 'B', 'A'];

    function makeMelody(st, c, phrasePos, steps) {
      const s = st.song, R = st.R, notes = [];
      if (R() > s.density + (phrasePos === 3 ? -0.2 : 0.15)) return notes;   // a breath
      const shapes = s.beats === 3 ? RHYTHMS3 : RHYTHMS4;
      let onsets = shapes[Math.floor(R() * shapes.length)].filter(i => i < steps);
      if (phrasePos === 3) onsets = onsets.slice(0, 2);
      const chordPcs = c.ints.map(i => (c.root + i) % 12);
      onsets.forEach((i, k) => {
        const next = k + 1 < onsets.length ? onsets[k + 1] : steps + (phrasePos === 3 ? 2 : 0);
        // move by small steps through the scale; land on chord tones on strong beats
        let idx = st.pool.indexOf(st.lastMel);
        if (idx < 0) idx = Math.floor(st.pool.length / 2);
        const r = R(), step = r < 0.38 ? 1 : r < 0.76 ? -1 : r < 0.88 ? 2 : -2;
        idx = Math.max(2, Math.min(st.pool.length - 3, idx + step));
        let m = st.pool[idx];
        if (i % 2 === 0 || k === onsets.length - 1) {
          for (let dd = 0; dd < 3; dd++) {
            if (chordPcs.includes(((m % 12) + 12) % 12)) break;
            m = st.pool[Math.min(st.pool.length - 1, st.pool.indexOf(m) + 1)];
          }
        }
        st.lastMel = m;
        notes.push({ i, m, len: next - i, v: 0.5 + R() * 0.15 });
      });
      return notes;
    }

    /* schedules one bar starting at time t */
    function scheduleBar(st, bar, t) {
      const s = st.song, R = st.R;
      const beat = 60 / s.bpm, eighth = beat / 2, barDur = beat * s.beats;
      const steps = s.beats * 2;
      const sw = i => (i % 2 ? s.swing * eighth : 0);
      const c = chord(s.prog[bar % s.prog.length]);
      const intro = bar < 4, outro = bar >= s.bars - 2;
      const fade = outro ? 0.55 : intro ? 0.85 : 1;

      // chords
      const voicing = voiceChord(st, c);
      if (s.comp === 'pad') {
        voicing.forEach(m => inst.pad(m, t, barDur * 0.98, 0.9 * fade));
      } else if (s.groove === 'bossa') {
        // light syncopated bossa comping
        [[0, 2, 0.5], [3, 1, 0.38], [6, 2, 0.4]].forEach(([i, l, v]) =>
          voicing.forEach(m => inst[s.comp](m, t + i * eighth, eighth * l, v * fade)));
      } else if (s.beats === 3) {
        voicing.forEach(m => inst[s.comp](m, t + R() * 0.01, barDur * 0.9, 0.45 * fade));
        [2, 4].forEach(i => voicing.slice(1).forEach(m => inst[s.comp](m, t + i * eighth, eighth * 2, 0.26 * fade)));
      } else {
        voicing.forEach(m => inst[s.comp](m, t + R() * 0.01, eighth * 4, 0.45 * fade));
        voicing.forEach(m => inst[s.comp](m, t + 5 * eighth + sw(5), eighth * 3, 0.3 * fade));
      }

      // bass
      const root = 36 + ((c.root % 12) + 12) % 12;
      const fifth = root + (c.ints.includes(7) ? 7 : c.ints[2] || 7);
      if (s.bass === 'bossa') {
        [[0, root, 3, 0.9], [3, root, 1, 0.6], [4, fifth, 3, 0.8], [7, fifth, 1, 0.55]].forEach(([i, m, l, v]) =>
          inst.bass(m, t + i * eighth, eighth * l * 0.95, v * fade));
      } else if (s.bass === 'walk') {
        const third = root + c.ints[1];
        [root, third, fifth, R() < 0.5 ? third : root + 12].forEach((m, k) => inst.bass(m, t + k * beat, beat * 0.9, (k ? 0.6 : 0.85) * fade));
      } else {
        inst.bass(root, t, beat * (s.beats === 3 ? 2.6 : 2) * 0.95, 0.8 * fade);
        if (s.beats === 4) inst.bass(R() < 0.6 ? fifth : root, t + beat * 2 + sw(4), beat * 1.8, 0.6 * fade);
      }

      // very soft percussion
      if (!intro && !outro && s.groove !== 'none') {
        for (let i = 0; i < steps; i++) {
          const at = t + i * eighth + sw(i);
          if (s.groove === 'bossa') {
            inst.shaker(at, i % 2 ? 0.6 : 1);
            if ([0, 3, 6].includes(i) && bar % 2 === 0 || [2, 4].includes(i) && bar % 2 === 1) inst.rim(at, 0.8);
          } else if (s.groove === 'shaker') {
            inst.shaker(at, i % 2 ? 0.55 : 0.9);
          } else if (s.groove === 'brush') {
            if (i % 2 === 0) inst.brush(at, i === 2 || i === 6 ? 0.9 : 0.55);
          } else if (s.groove === 'waltz') {
            if (i === 2 || i === 4) inst.brush(at, 0.7);
          }
        }
      }

      // melody (cached so the tune comes back, like a real song)
      if (!intro && bar < s.bars - 1) {
        const rel = bar - 4, pos = rel % st.cycle, part = FORM[Math.floor(rel / st.cycle) % FORM.length];
        const keyName = part + pos;
        if (!st.motifs[keyName]) st.motifs[keyName] = makeMelody(st, c, rel % 4, steps);
        st.motifs[keyName].forEach(n =>
          inst[s.lead](n.m, t + n.i * eighth + sw(n.i), n.len * eighth * 0.95, n.v * fade));
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

  const VOLUME = 0.26;          // quiet background level
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
