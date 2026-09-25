/* =====================================================================
   Alrayhan — café classics
   10 famous public-domain pieces that are loved in cafés and malls
   (Satie, Beethoven, Pachelbel, Joplin, Bach, Brahms and traditional
   tunes), arranged softly for background listening and played live in
   the visitor's browser with the Web Audio API. There are no audio
   files to download: every note is written in the song list below.

   The visitor starts / stops the music with the ♫ button in the header.
   Songs follow each other in random order, never the same one twice
   in a row.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------------- music theory ---------------- */
  const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
  const QUALITY = {
    '': [0, 4, 7], m: [0, 3, 7], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], '7': [0, 4, 7, 10], '6': [0, 4, 7, 9], sus4: [0, 5, 7]
  };
  function chord(sym) {
    const m = /^([A-G](?:#|b)?)(.*)$/.exec(sym);
    if (!m || !(m[2] in QUALITY)) throw new Error('bad chord ' + sym);
    return { root: NOTE[m[1]], ints: QUALITY[m[2]] };
  }
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  function midi(name) {
    const m = /^([A-G](?:#|b)?)(-?\d)$/.exec(name);
    if (!m) throw new Error('bad note ' + name);
    return 12 * (Number(m[2]) + 1) + NOTE[m[1]];
  }

  /* a small seeded random generator for gentle, human-like variation */
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---------------- score notation ----------------
     mel: "E5:2 D#5 r:3 | ..."  note:length in steps (default 1), r = rest,
          | marks a bar line (checked). A note may be longer than a bar.
     ch:  "Am | E | C G7 | -"   one entry per bar; several chords share the
          bar equally; "-" = no accompaniment in that bar.                */
  function parseSection(sec, perBar, name) {
    const notes = []; let pos = 0;
    sec.mel.trim().split(/\s+/).forEach(tok => {
      if (tok === '|') { if (pos % perBar) throw new Error(name + ': bar line at step ' + pos); return; }
      const [p, l] = tok.split(':'); const len = l ? Number(l) : 1;
      if (!(len > 0)) throw new Error(name + ': bad length ' + tok);
      if (p !== 'r') notes.push({ at: pos, m: midi(p), len });
      pos += len;
    });
    if (pos % perBar) throw new Error(name + ': melody is ' + pos + ' steps, not whole bars');
    const nBars = pos / perBar;
    const ch = sec.ch.split('|').map(s => s.trim());
    if (ch.length !== nBars) throw new Error(name + ': ' + ch.length + ' chord bars for ' + nBars + ' melody bars');
    const bars = [];
    for (let b = 0; b < nBars; b++) {
      const syms = ch[b] === '-' ? [] : ch[b].split(/\s+/);
      const segLen = syms.length ? perBar / syms.length : 0;
      bars.push({
        notes: notes.filter(n => n.at >= b * perBar && n.at < (b + 1) * perBar).map(n => ({ s: n.at - b * perBar, m: n.m, len: n.len })),
        chords: syms.map((s, i) => ({ c: chord(s), s: i * segLen, len: segLen }))
      });
    }
    return bars;
  }
  function chordBars(str, perBar) {
    return str.split('|').map(s => {
      const syms = s.trim().split(/\s+/), segLen = perBar / syms.length;
      return { notes: [], chords: syms.map((x, i) => ({ c: chord(x), s: i * segLen, len: segLen })) };
    });
  }

  /* ---------------- the 10 café classics ---------------- */
  const SONGS = [
    { ar: 'جمنوبيدي رقم ١ — ساتي', en: 'Gymnopédie No.1 · Satie', bpm: 72, beats: 3, sub: 2,
      lead: 'piano', lead2: 'vibes', comp: 'gymno', passes: 2,
      intro: 'Gmaj7 | Dmaj7 | Gmaj7 | Dmaj7', end: 'Dmaj7',
      form: ['A', 'B', 'A'],
      sections: {
        A: { mel: 'r:2 F#5:2 A5:2 | G5:2 F#5:2 C#5:2 | B4:2 C#5:2 D5:2 | A4:6 | F#4:24',
             ch: 'Gmaj7 | Dmaj7 | Gmaj7 | Dmaj7 | Gmaj7 | Dmaj7 | Gmaj7 | Dmaj7' },
        B: { mel: 'r:2 F#5:2 A5:2 | G5:2 F#5:2 C#5:2 | B4:2 C#5:2 D5:2 | A4:6 | C#5:6 | F#5:6 | E5:12',
             ch: 'Gmaj7 | Dmaj7 | Gmaj7 | Dmaj7 | Gmaj7 | Dmaj7 | Gmaj7 | Dmaj7' } } },

    { ar: 'إلى إليز — بيتهوفن', en: 'Für Elise · Beethoven', bpm: 104, beats: 3, sub: 2,
      lead: 'piano', lead2: 'rhodes', comp: 'elise', passes: 2,
      intro: 'Am', end: 'Am',
      form: ['P', 'A1', 'A2', 'B', 'A3'],
      sections: {
        P: { mel: 'r:4 E5 D#5', ch: '-' },
        A1: { mel: 'E5 D#5 E5 B4 D5 C5 | A4:2 r C4 E4 A4 | B4:2 r E4 G#4 B4 | C5:2 r E4 E5 D#5 | E5 D#5 E5 B4 D5 C5 | A4:2 r C4 E4 A4 | B4:2 r E4 C5 B4 | A4:2 r:2 E5 D#5',
              ch: '- | Am | E | Am | - | Am | E | Am' },
        A2: { mel: 'E5 D#5 E5 B4 D5 C5 | A4:2 r C4 E4 A4 | B4:2 r E4 G#4 B4 | C5:2 r E4 E5 D#5 | E5 D#5 E5 B4 D5 C5 | A4:2 r C4 E4 A4 | B4:2 r E4 C5 B4 | A4:2 r B4 C5 D5',
              ch: '- | Am | E | Am | - | Am | E | Am' },
        B: { mel: 'E5:3 G4 F5 E5 | D5:3 F4 E5 D5 | C5:3 E4 D5 C5 | B4:2 r:2 E5 D#5', ch: 'C | G | Am | E' },
        A3: { mel: 'E5 D#5 E5 B4 D5 C5 | A4:2 r C4 E4 A4 | B4:2 r E4 G#4 B4 | C5:2 r E4 E5 D#5 | E5 D#5 E5 B4 D5 C5 | A4:2 r C4 E4 A4 | B4:2 r E4 C5 B4 | A4:6',
              ch: '- | Am | E | Am | - | Am | E | Am' } } },

    { ar: 'كانون — باخلبل', en: 'Canon in D · Pachelbel', bpm: 66, beats: 4, sub: 2,
      lead: 'piano', lead2: 'vibes', comp: 'canon', passes: 4,
      intro: 'D A Bm F#m | G D G A', end: 'D',
      form: ['V1', 'V2', 'V3'],
      sections: {
        V1: { mel: 'F#5:2 E5:2 D5:2 C#5:2 | B4:2 A4:2 B4:2 C#5:2', ch: 'D A Bm F#m | G D G A' },
        V2: { mel: 'D5:2 C#5:2 B4:2 A4:2 | G4:2 F#4:2 G4:2 E4:2', ch: 'D A Bm F#m | G D G A' },
        V3: { mel: 'D5 F#5 A5 G5 F#5 D5 F#5 E5 | D5 B4 D5 A4 G4 B4 A4 G4', ch: 'D A Bm F#m | G D G A' } } },

    { ar: 'المُسلّي — جوبلين', en: 'The Entertainer · Joplin', bpm: 70, beats: 2, sub: 4,
      lead: 'piano', lead2: 'rhodes', comp: 'stride', passes: 2, shift: -12,
      intro: 'C | G7', end: 'C',
      form: ['P', 'A', 'P', 'A'],
      sections: {
        P: { mel: 'r:6 D5 D#5', ch: '-' },
        A: { mel: 'E5 C6:2 E5 C6:2 E5 C6 | C6:5 C6 D6 D#6 | E6 C6 D6 E6:2 B5 D6:2 | C6:6 D5 D#5 | E5 C6:2 E5 C6:2 E5 C6 | C6:4 A5 G5 F#5 A5 | C6 E6:2 D6 C6 A5 D6:2 | D6:6 D5 D#5 | E5 C6:2 E5 C6:2 E5 C6 | C6:5 C6 D6 D#6 | E6 C6 D6 E6:2 B5 D6:2 | C6:8',
             ch: 'C | C | C G7 | C | C | C D7 | D7 | G G7 | C | C | C G7 | C' } } },

    { ar: 'الأكمام الخضراء — تراثية', en: 'Greensleeves · Traditional', bpm: 84, beats: 3, sub: 2,
      lead: 'pluck', lead2: 'piano', comp: 'arp', passes: 2,
      intro: 'Am | E', end: 'Am',
      form: ['P', 'V', 'R'],
      sections: {
        P: { mel: 'r:4 A4:2', ch: 'Am' },
        V: { mel: 'C5:4 D5:2 | E5:3 F5 E5:2 | D5:4 B4:2 | G4:3 A4 B4:2 | C5:4 A4:2 | A4:3 G#4 A4:2 | B4:4 G#4:2 | E4:4 A4:2 | C5:4 D5:2 | E5:3 F5 E5:2 | D5:4 B4:2 | G4:3 A4 B4:2 | C5:3 B4 A4:2 | G#4:3 F#4 G#4:2 | A4:6 | A4:6',
             ch: 'Am | C | G | Em | Am | F | E | E | Am | C | G | Em | Am | E | Am | Am' },
        R: { mel: 'G5:6 | G5:3 F#5 E5:2 | D5:4 B4:2 | G4:3 A4 B4:2 | C5:4 A4:2 | A4:3 G#4 A4:2 | B4:4 G#4:2 | E4:6 | G5:6 | G5:3 F#5 E5:2 | D5:4 B4:2 | G4:3 A4 B4:2 | C5:3 B4 A4:2 | G#4:3 F#4 G#4:2 | A4:6 | A4:6',
             ch: 'C | Em | G | Em | Am | F | E | E | C | Em | G | Em | Am | E | Am | Am' } } },

    { ar: 'نشيد الفرح — بيتهوفن', en: 'Ode to Joy · Beethoven', bpm: 100, beats: 4, sub: 2,
      lead: 'rhodes', lead2: 'vibes', comp: 'bossa', groove: 'bossa', passes: 3,
      intro: 'C | G', end: 'C',
      form: ['A', 'B'],
      sections: {
        A: { mel: 'E5:2 E5:2 F5:2 G5:2 | G5:2 F5:2 E5:2 D5:2 | C5:2 C5:2 D5:2 E5:2 | E5:3 D5 D5:4 | E5:2 E5:2 F5:2 G5:2 | G5:2 F5:2 E5:2 D5:2 | C5:2 C5:2 D5:2 E5:2 | D5:3 C5 C5:4',
             ch: 'C | G | C | G | C | G | C | G C' },
        B: { mel: 'D5:2 D5:2 E5:2 C5:2 | D5:2 E5 F5 E5:2 C5:2 | D5:2 E5 F5 E5:2 D5:2 | C5:2 D5:2 G4:4 | E5:2 E5:2 F5:2 G5:2 | G5:2 F5:2 E5:2 D5:2 | C5:2 C5:2 D5:2 E5:2 | D5:3 C5 C5:4',
             ch: 'G C | G C | G | C G | C | G | C | G C' } } },

    { ar: 'مينويت في صول — باخ', en: 'Minuet in G · Bach / Petzold', bpm: 100, beats: 3, sub: 2,
      lead: 'piano', lead2: 'vibes', comp: 'waltz', passes: 2,
      intro: 'G | D', end: 'G',
      form: ['A', 'B'],
      sections: {
        A: { mel: 'D5:2 G4 A4 B4 C5 | D5:2 G4:2 G4:2 | E5:2 C5 D5 E5 F#5 | G5:2 G4:2 G4:2 | C5:2 D5 C5 B4 A4 | B4:2 C5 B4 A4 G4 | F#4:2 G4 A4 B4 G4 | B4:2 A4:4 | D5:2 G4 A4 B4 C5 | D5:2 G4:2 G4:2 | E5:2 C5 D5 E5 F#5 | G5:2 G4:2 G4:2 | C5:2 D5 C5 B4 A4 | B4:2 C5 B4 A4 G4 | A4:2 B4 A4 G4 F#4 | G4:6',
             ch: 'G | G | C | G | Am | G | D | D | G | G | C | G | Am | G | D | G' },
        B: { mel: 'B5:2 G5 A5 B5 G5 | A5:2 D5 E5 F#5 D5 | G5:2 E5 F#5 G5 D5 | C#5:2 B4 C#5 A4:2 | A4 B4 C#5 D5 E5 F#5 | G5:2 F#5:2 E5:2 | F#5:2 A4:2 C#5:2 | D5:6',
             ch: 'G | D | Em | A | A | Em A | D A | D' } } },

    { ar: 'سكاربورو فير — تراثية', en: 'Scarborough Fair · Traditional', bpm: 88, beats: 3, sub: 2,
      lead: 'pluck', lead2: 'vibes', comp: 'arp', passes: 3, shift: 12,
      intro: 'Dm | C', end: 'Dm',
      form: ['S'],
      sections: {
        S: { mel: 'D4:4 D4:2 | A4:4 A4:2 | E4:3 F4 E4:2 | D4:6 | r:2 A4:2 C5:2 | D5:4 C5:2 | A4:2 B4:2 G4:2 | A4:6 | r:2 D5:2 D5:2 | D5:4 C5:2 | A4:4 A4:2 | G4:2 F4:2 E4:2 | D4:4 A4:2 | G4:4 F4:2 | E4:2 D4:2 C4:2 | D4:6',
             ch: 'Dm | Dm | C | Dm | F | G | G | Dm | Dm | G | Dm | C | Dm | C | Am | Dm' } } },

    { ar: 'تهويدة برامز', en: 'Lullaby (Wiegenlied) · Brahms', bpm: 80, beats: 3, sub: 2,
      lead: 'vibes', lead2: 'piano', comp: 'arp', passes: 3,
      intro: 'C | G7', end: 'C',
      form: ['P', 'L'],
      sections: {
        P: { mel: 'r:4 E5 E5', ch: 'C' },
        L: { mel: 'G5:4 E5 E5 | G5:4 E5 G5 | C6:2 B5:3 A5 | A5:2 G5:2 D5 E5 | F5:2 D5:2 D5 E5 | F5:4 D5 F5 | B5 A5 G5:2 B5:2 | C6:4 C5 C5 | C6:4 A5 F5 | G5:4 E5 C5 | F5:2 G5:2 A5:2 | G5:4 C5 C5 | C6:4 A5 F5 | G5:4 E5 C5 | F5:2 E5:2 D5:2 | C5:6',
             ch: 'C | C | F | C | G7 | G7 | G7 | C | F | C | G7 | C | F | C | G7 | C' } } },

    { ar: 'بهجة الإنسان — باخ', en: 'Jesu, Joy of Man’s Desiring · Bach', bpm: 60, beats: 3, sub: 3,
      lead: 'piano', lead2: 'vibes', comp: 'hymn', passes: 4,
      intro: 'G | D7', end: 'G',
      form: ['J'],
      sections: {
        J: { mel: 'G4 A4 B4 D5 C5 C5 E5 D5 D5 | G5 F#5 G5 D5 B4 G4 A4 B4 C5 | D5 E5 D5 C5 B4 A4 B4 G4 F#4 | E4 F#4 G4 D4 F#4 A4 C5 B4 A4 | B4 G4 A4 B4 D5 C5 C5 E5 D5 | D5 G5 F#5 G5 D5 B4 G4 A4 B4 | E5 D5 C5 B4 A4 G4 D4 G4 F#4 | G4:9',
             ch: 'G | G | D D7 G | Em D D7 | G G Am | G | C G D7 | G' } } }
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

    /* ---------------- arrangement ---------------- */
    function prepare(song, seed) {
      const perBar = song.beats * song.sub;
      const parsed = {};
      Object.keys(song.sections).forEach(k => { parsed[k] = parseSection(song.sections[k], perBar, song.en + ' ' + k); });
      const bars = [];
      chordBars(song.intro, perBar).forEach(b => bars.push(Object.assign(b, { pass: 0, intro: true })));
      for (let p = 0; p < (song.passes || 1); p++) {
        song.form.forEach(k => parsed[k].forEach(b => bars.push(Object.assign({}, b, { pass: p }))));
      }
      chordBars(song.end, perBar).forEach(b => bars.push(Object.assign(b, { pass: 0, end: true })));
      return { song, R: rng(seed), perBar, bars, total: bars.length, lastVoicing: null };
    }

    function voiceChord(st, c) {
      // close voicing around middle C, nearest to the previous chord (smooth voice leading)
      const tones = c.ints.slice(0, 4).map(i => c.root + i);
      let best = null, bestScore = 1e9;
      for (let base = 50; base <= 60; base++) {
        const v = tones.map(t => base + ((t - base) % 12 + 12) % 12).sort((a, b) => a - b);
        const center = v.reduce((a, b) => a + b, 0) / v.length;
        const score = st.lastVoicing ? Math.abs(center - st.lastVoicing) : Math.abs(center - 56);
        if (score < bestScore) { bestScore = score; best = v; }
      }
      st.lastVoicing = best.reduce((a, b) => a + b, 0) / best.length;
      return best;
    }
    const low = (c, from) => from + ((c.root - from) % 12 + 12) % 12;      // chord root in the octave starting at `from`
    const fifthOf = (c, r) => r + (c.ints.includes(7) ? 7 : c.ints[2]);

    /* schedules one bar starting at time t */
    function scheduleBar(st, i, t) {
      const s = st.song, R = st.R, b = st.bars[i];
      const beat = 60 / s.bpm, step = beat / s.sub, barDur = beat * s.beats;
      const at = k => t + k * step;
      const fade = b.end ? 0.8 : 1;
      const segAt = k => b.chords.find(x => k >= x.s && k < x.s + x.len);

      // accompaniment
      b.chords.forEach(seg => {
        const c = seg.c, v = voiceChord(st, c), segDur = seg.len * step;
        if (b.end) {                                   // final chord: one soft, ringing strum
          inst.bass(low(c, 36), t, barDur * 1.5, 0.7);
          v.forEach((m, k) => inst.piano(m, t + k * 0.05, barDur * 1.5, 0.4));
          return;
        }
        switch (s.comp) {
          case 'gymno':                                  // low bass note, then the chord on beat 2
            inst.piano(low(c, 36), at(seg.s), segDur, 0.5 * fade);
            v.forEach(m => inst.piano(m, at(seg.s + s.sub), segDur - beat, 0.3 * fade));
            break;
          case 'elise': {                                // rising broken chord in the left hand
            const r = low(c, 40);
            [r, r + 7, r + 12].forEach((m, k) => inst.piano(m, at(seg.s + k), segDur - k * step, 0.34 * fade));
            break;
          }
          case 'canon':
            inst.bass(low(c, 36), at(seg.s), segDur * 0.95, 0.75 * fade);
            v.forEach(m => inst.pad(m, at(seg.s), segDur, 0.8 * fade));
            break;
          case 'hymn':
            inst.bass(low(c, 36), at(seg.s), segDur * 0.95, 0.7 * fade);
            v.forEach(m => inst.pad(m, at(seg.s), segDur, 0.75 * fade));
            break;
          case 'arp': {                                  // bass + gentle broken chord on every step
            inst.bass(low(c, 36), at(seg.s), segDur * 0.95, 0.65 * fade);
            const pat = [0, 1, 2, 1];
            for (let k = 1; k < seg.len; k++) inst.piano(v[pat[(k - 1) % 4]], at(seg.s + k), step * 1.6, (0.22 + R() * 0.04) * fade);
            break;
          }
          default: break;                                // stride / waltz / bossa are beat based (below)
        }
      });

      if (!b.end && b.chords.length) {
        if (s.comp === 'stride' || s.comp === 'waltz') {
          for (let bt = 0; bt < s.beats; bt++) {
            const seg = segAt(bt * s.sub); if (!seg) continue;
            const c = seg.c, r = low(c, 36);
            if (s.comp === 'stride') {                   // soft "oom-pah": bass, chord, bass, chord
              inst.piano(bt * s.sub === seg.s ? r : fifthOf(c, r) - 12, at(bt * s.sub), step * s.sub * 0.5, 0.42 * fade);
              voiceChord(st, c).forEach(m => inst.piano(m, at(bt * s.sub + s.sub / 2), step * s.sub * 0.45, 0.24 * fade));
            } else if (bt === 0 || bt * s.sub === seg.s) {
              inst.bass(r, at(bt * s.sub), beat * 0.95, 0.7 * fade);
            } else {
              voiceChord(st, c).forEach(m => inst.piano(m, at(bt * s.sub), beat * 0.8, 0.24 * fade));
            }
          }
        } else if (s.comp === 'bossa') {
          [[0, 2, 0.45], [3, 1, 0.34], [6, 2, 0.38]].forEach(([k, l, vel]) => {
            const seg = segAt(k); if (seg) voiceChord(st, seg.c).forEach(m => inst.rhodes(m, at(k), step * l, vel * fade));
          });
          [[0, 0, 3, 0.9], [3, 0, 1, 0.6], [4, 1, 3, 0.8], [7, 1, 1, 0.55]].forEach(([k, five, l, vel]) => {
            const seg = segAt(k); if (!seg) return;
            const r = low(seg.c, 36);
            inst.bass(five ? fifthOf(seg.c, r) : r, at(k), step * l * 0.95, vel * fade);
          });
        }
      }

      // very soft percussion
      if (s.groove === 'bossa' && !b.intro && !b.end) {
        for (let k = 0; k < st.perBar; k++) {
          inst.shaker(at(k), k % 2 ? 0.6 : 1);
          if ([0, 3, 6].includes(k) && i % 2 === 0 || [2, 4].includes(k) && i % 2 === 1) inst.rim(at(k), 0.8);
        }
      }

      // melody — second time round it moves to another instrument
      const lead = b.pass % 2 === 1 && s.lead2 ? s.lead2 : s.lead;
      b.notes.forEach(n => {
        const accent = n.s % (s.sub * s.beats) === 0 ? 0.08 : 0;
        inst[lead](n.m + (s.shift || 0), at(n.s) + R() * 0.006, n.len * step * 0.96, (0.56 + accent + R() * 0.06) * fade);
      });
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
      if (bar >= st.total) { nextBarTime += 1.2; nextSong(); continue; }
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
