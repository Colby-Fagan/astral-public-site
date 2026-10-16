/* ASTRAL scroll visual: ASTRAL constellation -> double helix -> transcripts -> flagged -> priority list.
   Decorative and synthetic: no data, no network requests.
   One 3D particle field seen through a perspective camera. Each stage gives every particle a place;
   moving between stages sends particles along curved paths while the camera glides to a new view. */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const mix = (a, b, t) => a + (b - a) * t;
  const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function gaussian(r) { return () => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r()); }; }

  /* Palette: every particle colour is an index into this list; each entry gets a soft and a crisp sprite. */
  const PAL = [];
  const add = c => (PAL.push(c), PAL.length - 1);
  const BLUE = [[12, 30, 54], [20, 52, 88], [30, 84, 132], [44, 120, 176], [70, 156, 212], [112, 190, 234], [156, 214, 246], [198, 233, 252], [228, 244, 255], [255, 255, 255]].map(add);
  const WARM = [[255, 186, 120], [255, 206, 150], [255, 224, 184], [255, 238, 214], [255, 249, 238]].map(add);
  const AMBER = [[214, 128, 34], [240, 168, 62], [247, 196, 108], [255, 222, 164]].map(add);
  const BASE = [[76, 206, 230], [140, 122, 255], [86, 222, 178], [150, 178, 255]].map(add);
  const RED = [[140, 28, 34], [206, 48, 56], [242, 75, 80], [255, 140, 136]].map(add); // ASTRAL logo red, for priority 1
  const WHITE = BLUE[9];

  function sprite(rgb, crisp) {
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const g = c.getContext('2d'), gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    const col = a => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    if (crisp) { gr.addColorStop(0, col(1)); gr.addColorStop(.3, col(1)); gr.addColorStop(.4, col(.32)); gr.addColorStop(.62, col(.05)); gr.addColorStop(1, col(0)); }
    else { gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(.08, col(1)); gr.addColorStop(.18, col(.38)); gr.addColorStop(.42, col(.07)); gr.addColorStop(1, col(0)); }
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    return c;
  }
  let SPRITES = null; // [soft, crisp] arrays
  const SPRITE_K = [1 / .17, 1 / .36]; // half-size of the drawn sprite per unit of dot radius

  const STAGES = [
    { name: 'Constellation', cam: { yaw: -.2, pitch: .08, dist: 4.75, roll: 0, tx: .02, ty: .02, tz: 0 }, arc: .5, tr: 1.7, spread: 1 },
    { name: 'Helix', cam: { yaw: .64, pitch: .1, dist: 4.55, roll: -.4, tx: -.42, ty: .06, tz: 0 }, arc: .45, tr: 1.7, spread: 1 },
    { name: 'Transcripts', cam: { yaw: -.36, pitch: .06, dist: 4.4, roll: 0, tx: .16, ty: 0, tz: .32 }, arc: .5, tr: 1.6, spread: .6 },
    { name: 'Flagged', cam: { yaw: -.3, pitch: .05, dist: 4.2, roll: 0, tx: .16, ty: 0, tz: .32 }, arc: .12, tr: .55 },
    { name: 'Priority', cam: { yaw: -.04, pitch: .0, dist: 3.35, roll: 0, tx: .1, ty: 0, tz: 0 }, arc: .14, tr: 1.6 }
  ];
  const TIERS = [1, 2, 2, 3, 3];
  // All stage changes share one pace: particle delay spread + travel time comes to about CAM_T seconds.
  const CAM_T = 2.2;
  // Focal length as a multiple of the free width; at this scale the widest stage just fits.
  const FIT = 1.36;
  // Narrow screens see the scene through a slightly different camera so nothing is cut off.
  const MOBILE_CAM = [{ yaw: -.12, dist: 3.75 }, { yaw: .42, dist: 5.1, roll: -.62, tx: .1, ty: 0 }, { dist: 4.6, tx: .02 }, { dist: 4.45, tx: .02 }, { dist: 3.3, tx: -.02 }];
  // Soft light behind each stage, in screen space: [rgb, alpha, radius as a share of the focal length].
  const ATMOS = [['70,120,190', .2, .5], ['70,150,200', .12, .62], ['40,90,140', .1, .7], ['40,90,140', .08, .7], ['200,140,60', .07, .45]];

  function create(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const labelFont = 'italic 400 12.5px "JetBrains Mono", ui-monospace, Menlo, monospace';
    let W = 0, H = 0, DPR = 1, N = 0, F = 1, CX = 0, CY = 0, R0 = 1.4, mobile = false;
    let backdrop = null, twinkle = [];
    let X, Y, Z, A, S, COL, STY;            // current state
    let FX, FY, FZ, FA, FS, FCOL, FSTY;     // snapshot at stage entry
    let AX, AY, AZ, DEL;                    // arc direction, per-particle delay
    let C, HX, CD, cards = [], wall = {};
    let stage = opts.start || 0, prevStage = stage, st = 0, clock = 0, last = 0, raf = 0, visible = true, TR = 2, ARC = .4;
    const camBase = Object.assign({}, STAGES[stage].cam), camFrom = Object.assign({}, camBase), eff = Object.assign({}, camBase);
    const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
    const o = { x: 0, y: 0, z: 0, a: 1, size: 1, col: 0, sty: 0, col2: -1, w2: 0 };
    const pj = { x: 0, y: 0, s: 1, z: 1, v: true };
    let bx0, by0, bx1, by1;                // per-card screen bounds
    let cyaw = 1, syaw = 0, cpit = 1, spit = 0, crol = 1, srol = 0;

    /* ---------- layouts ---------- */
    function slots(n, extra) {
      const s = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), col: new Uint8Array(n), sty: new Uint8Array(n), size: new Float32Array(n), a: new Float32Array(n), key: new Float32Array(n), map: new Int32Array(n) };
      (extra || []).forEach(k => (s[k] = new Float32Array(n)));
      return s;
    }
    function finishMap(L) {
      const idx = [...Array(N).keys()].sort((p, q) => L.key[p] - L.key[q]);
      idx.forEach((slot, rank) => (L.map[rank] = slot));
    }

    // Constellation: the ASTRAL mark drawn as stars. Thirteen bright stars sit where the logo's dots are, dotted
    // lines join them (the apex first, down both sides together, then the crossbar from both ends), and a deep
    // field of faint stars and haze surrounds them. Once drawn, a pulse of light runs along the lines now and then.
    const MARK = [[32, 6], [27, 16], [37, 16], [22, 26], [42, 26], [17, 36], [27, 36], [37, 36], [47, 36], [12, 46], [52, 46], [7, 56], [57, 56]];
    const MARK_R = 1.2, SEG = .3, DRAWN = 5 * SEG, PULSE = 6.5;
    // [from, to, start, duration] in seconds from the start of the drawing; point 13 is the middle of the crossbar.
    const STROKES = [];
    [[0, 1, 3, 5, 9, 11], [0, 2, 4, 8, 10, 12]].forEach(side => { for (let k = 0; k < 5; k++) STROKES.push([side[k], side[k + 1], k * SEG, SEG]); });
    STROKES.push([5, 6, 3 * SEG, SEG], [8, 7, 3 * SEG, SEG], [6, 13, 4 * SEG, SEG * .6], [7, 13, 4 * SEG, SEG * .6]);
    let C0 = .3, lineFade = 0;              // when the drawing starts (seconds into the stage); overlay line strength
    const starT = new Float32Array(13);     // when each star lights, from the start of the drawing
    function buildMark() {
      const r = rng(7), g = gaussian(r), L = slots(N, ['q', 'kind', 'star', 'ph', 'tw']);
      const pts = MARK.map(([x, y], j) => [(x - 32) / 26 * MARK_R + g() * .018, (31 - y) / 26 * MARK_R + g() * .018, j ? g() * .12 : .22]);
      pts.push(pts[6].map((v, k) => (v + pts[7][k]) / 2));
      starT.fill(99); starT[0] = -.15;
      STROKES.forEach(([a, b, t0, d]) => { starT[a] = Math.min(starT[a], t0); if (b < 13) starT[b] = Math.min(starT[b], t0 + d); });
      const centre = [];
      let n = 0;
      const put = (x, y, z, col, sty, size, a, kind, q, star) => {
        L.x[n] = x; L.y[n] = y; L.z[n] = z; L.col[n] = col; L.sty[n] = sty; L.size[n] = size; L.a[n] = a;
        L.kind[n] = kind; L.q[n] = q; L.star[n] = star; L.ph[n] = r() * TAU; L.tw[n] = .3 + r() * 1.4;
        L.key[n] = clamp((x + 3.4) / 6.8 + g() * .01); n++;
      };
      // stars: a hot core with a soft halo; the first particle of each sits exactly on the star
      pts.slice(0, 13).forEach(([x, y, z], j) => {
        const apex = j === 0, core = mobile ? 12 : 20, halo = mobile ? 6 : 12;
        centre.push(n);
        for (let k = 0; k < core; k++) { const sp = k ? .007 : 0; put(x + g() * sp, y + g() * sp, z + g() * sp, apex ? BLUE[k % 3 ? 5 : 6] : (k % 4 ? WHITE : BLUE[7]), 0, (apex ? 1.35 : 1.05) + r() * .45, .85, 0, 0, j); }
        for (let k = 0; k < halo; k++) { const sp = .035 + r() * .04, an = r() * TAU; put(x + Math.cos(an) * sp, y + Math.sin(an) * sp, z + g() * .01, apex ? BLUE[5] : BLUE[6], 0, .5 + r() * .3, .2, 0, 0, j); }
      });
      // dotted lines: crisp beads on the line and a soft glow beside it; q is when each bead is reached
      STROKES.forEach(([a, b, t0, d]) => {
        const A = pts[a], B = pts[b], len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]), steps = Math.max(4, Math.round(len / .021));
        for (let k = 1; k < steps; k++) {
          const v = k / steps, x = mix(A[0], B[0], v), y = mix(A[1], B[1], v), z = mix(A[2], B[2], v);
          put(x, y, z, BLUE[6], 1, .36, .72, 1, t0 + v * d, -1);
          if (!mobile || k % 2) put(x + g() * .014, y + g() * .014, z + g() * .01, BLUE[5], 0, .42, .2, 1, t0 + v * d, -1);
        }
      });
      // haze behind the mark, a faint diagonal band far away, and a deep field of stars
      const room = N - n, nHaze = Math.round(room * .14), nBand = Math.round(room * .12);
      for (let k = 0; k < nHaze; k++) put(g() * .95, g() * .75 - .05, .4 + Math.abs(g()) * .8, BLUE[2 + Math.floor(r() * 3)], 0, .55 + r() * .4, .05 + r() * .09, 2, 0, -1);
      for (let k = 0; k < nBand; k++) { const u = r() * 2 - 1; put(u * 3.6, u * 1.1 - .2 + g() * .32, 2.2 + r() * 1.4, BLUE[3 + Math.floor(r() * 3)], 0, .35 + r() * .3, .08 + .14 * r(), 2, 0, -1); }
      while (n < N) {
        const mag = Math.pow(r(), 2.6), tint = r();
        put((r() * 2 - 1) * 3.4, (r() * 2 - 1) * 2.2, -1.1 + r() * 4.4, tint < .72 ? BLUE[5 + Math.floor(r() * 4)] : tint < .92 ? WHITE : WARM[2 + Math.floor(r() * 3)], 0, .3 + mag * .75, .12 + .5 * mag, 3, 0, -1);
      }
      finishMap(L);
      L.inv = new Int32Array(N); for (let i = 0; i < N; i++) L.inv[L.map[i]] = i;
      L.centre = centre;
      return L;
    }
    function markAt(s, out) {
      const kind = C.kind[s], t = st - C0;
      out.x = C.x[s]; out.y = C.y[s]; out.z = C.z[s];
      out.col = C.col[s]; out.sty = C.sty[s]; out.size = C.size[s]; out.a = C.a[s]; out.col2 = -1; out.w2 = 0;
      const pulse = !reduce.matches && t > DRAWN + 1.2 ? (t - DRAWN - 1.2) % PULSE : -9;
      if (kind === 0) {                        // star: lights when the line reaches it, then flares with each pulse
        const ts = starT[C.star[s]], on = easeOut((t - ts + .1) / .35), flash = Math.exp(-Math.pow((t - ts - .12) / .16, 2));
        const pf = pulse > -9 ? Math.exp(-Math.pow((pulse - ts * .8) / .18, 2)) : 0;
        out.a *= mix(.12, 1, on); out.size *= mix(.55, 1, on) * (1 + .5 * flash + .35 * pf);
      } else if (kind === 1) {                 // line bead: appears as the drawing passes, brightens as a pulse passes
        const q = C.q[s], on = clamp((t - q) / .12), pb = pulse > -9 ? Math.exp(-Math.pow((pulse - q * .8) / .09, 2)) : 0;
        out.a *= on * (1 + 1.1 * pb); out.size *= 1 + .7 * pb;
        if (pb > .05) { out.col2 = WHITE; out.w2 = Math.min(1, pb); }
      } else if (kind === 3) {                 // background star: a slow twinkle
        out.a *= .72 + .28 * Math.sin(clock * C.tw[s] + C.ph[s]);
      }
    }

    // Helix: two glowing backbones, base-pair rungs in two colour pairs, and a faint sheath of drifting particles.
    const HL = 3.4, HRAD = .37, TURNS = 3, NPAIR = 34;
    function buildHelix() {
      const r = rng(11), g = gaussian(r), L = slots(N, ['u', 'kind', 'strand', 'jr', 'v', 'ang', 'w', 'rc']);
      const nStrand = Math.round(N * .44), nRung = Math.round(N * .3);
      const pairType = Array.from({ length: NPAIR }, () => (r() < .5 ? 0 : 1));
      let n = 0;
      for (let k = 0; k < nStrand; k++, n++) {
        const u = r() - .5;
        L.u[n] = u; L.kind[n] = 0; L.strand[n] = k & 1; L.jr[n] = g() * .016; L.v[n] = g() * .006;
        L.col[n] = BLUE[6 + Math.floor(r() * 3)]; L.size[n] = .6 + r() * .45; L.a[n] = .42 + .3 * r(); L.key[n] = u + .5;
      }
      for (let k = 0; k < nRung; k++, n++) {
        const p = Math.floor(r() * NPAIR), u = (p + .5) / NPAIR - .5, v = .06 + .88 * r(), half = v < .5 ? 0 : 1;
        L.u[n] = u; L.kind[n] = 1; L.v[n] = v; L.jr[n] = g() * .007;
        L.col[n] = pairType[p] ? BASE[2 + half] : BASE[half]; L.sty[n] = 0; L.size[n] = .55 + r() * .3; L.a[n] = .62; L.key[n] = u + .5;
      }
      while (n < N) {
        const u = (r() - .5) * 1.1;
        L.u[n] = u; L.kind[n] = 2; L.ang[n] = r() * TAU; L.w[n] = (.1 + r() * .25) * (r() < .5 ? -1 : 1); L.rc[n] = HRAD + .12 + Math.abs(g()) * .38;
        L.col[n] = BLUE[3 + Math.floor(r() * 4)]; L.size[n] = .45 + r() * .4; L.a[n] = .16 + .2 * r(); L.key[n] = clamp(u + .5); n++;
      }
      finishMap(L);
      return L;
    }
    function helixAt(s, out) {
      const u = HX.u[s], spin = clock * .5, kind = HX.kind[s];
      out.x = u * HL;
      if (kind === 0) { const ph = u * TURNS * TAU + spin + HX.strand[s] * Math.PI, rr = HRAD + HX.jr[s]; out.x += HX.v[s]; out.y = rr * Math.cos(ph); out.z = rr * Math.sin(ph); }
      else if (kind === 1) { const ph = u * TURNS * TAU + spin, c = HRAD * Math.cos(ph), sn = HRAD * Math.sin(ph), v = HX.v[s]; out.y = mix(c, -c, v) + HX.jr[s]; out.z = mix(sn, -sn, v); }
      else { const ang = HX.ang[s] + clock * HX.w[s]; out.y = HX.rc[s] * Math.cos(ang); out.z = HX.rc[s] * Math.sin(ang); }
      out.col = HX.col[s]; out.sty = 0; out.size = HX.size[s]; out.a = HX.a[s]; out.col2 = -1;
    }

    // Transcripts: a gently curved wall of dot-matrix chat transcripts. Bright dots are messages
    // (user turns right-aligned, model turns left), faint dots are the panel each transcript sits on.
    const CW = .3, CH = .4, GAPX = .075, GAPY = .085, RC = 3.1, GX = 9, GY = 8;
    function buildCards() {
      const r = rng(29), g = gaussian(r);
      const cols = mobile ? 6 : 8, rows = 5;
      const flagCells = mobile ? [[1, 1], [4, 0], [2, 3], [5, 2], [0, 4]] : [[2, 1], [6, 0], [4, 2], [6, 3], [1, 3]];
      cards = [];
      const dphi = (CW + GAPX) / RC;
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const flag = flagCells.findIndex(([c, rr]) => c === col && rr === row);
        cards.push({ col, row, phi: (col - (cols - 1) / 2) * dphi, y: ((rows - 1) / 2 - row) * (CH + GAPY), flag, seed: r() * TAU });
      }
      wall = { phiMin: -(cols - 1) / 2 * dphi, phiMax: (cols - 1) / 2 * dphi, h: rows * (CH + GAPY), cols, rows, flagged: [] };
      flagCells.forEach((_, j) => (wall.flagged[j] = cards.findIndex(c => c.flag === j)));
      const items = [];
      cards.forEach((cd, k) => {
        const grid = Array.from({ length: GY }, () => new Array(GX).fill(0));
        let row = 0;
        const turns = [['u', 1], ['m', 2], ['u', 1], ['m', 2], ['u', 1], ['m', 1]];
        for (const [who, nrows] of turns) {
          for (let q = 0; q < nrows && row < GY; q++, row++) {
            const len = who === 'u' ? 2 + Math.floor(r() * 4) : (q === nrows - 1 && nrows > 1 ? 3 + Math.floor(r() * 4) : 6 + Math.floor(r() * 3));
            for (let j = 0; j < len; j++) grid[row][who === 'u' ? GX - 1 - j : j] = who === 'u' ? 1 : 2;
          }
        }
        for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
          const t = grid[gy][gx];
          items.push({ k, t: t ? t - 1 : 2, lx: ((gx + .5) / GX - .5) * CW, ly: (.5 - (gy + .5) / GY) * CH, key: (cd.col + (gx + .5) / GX) / cols + g() * .002 });
        }
      });
      // Keep every message dot; drop panel dots at random if there are more items than particles.
      let content = items.filter(it => it.t < 2), panel = items.filter(it => it.t === 2);
      const room = Math.max(0, N - content.length);
      if (panel.length > room) { panel.sort(() => r() - .5); panel = panel.slice(0, room); }
      const all = content.concat(panel);
      const L = slots(N, ['card', 'lx', 'ly', 'type', 'seed']);
      for (let n = 0; n < N; n++) {
        if (n < all.length) {
          const it = all[n];
          L.card[n] = it.k; L.lx[n] = it.lx; L.ly[n] = it.ly; L.type[n] = it.t; L.key[n] = it.key;
          L.col[n] = it.t === 0 ? BASE[0] : it.t === 1 ? BLUE[7] : BLUE[2]; L.sty[n] = 1;
          L.size[n] = it.t === 2 ? .55 : it.t === 0 ? .8 : .72; L.a[n] = it.t === 2 ? .5 : .95;
        } else {
          L.card[n] = -1; L.type[n] = 3; L.key[n] = r();
          L.x[n] = (r() - .5) * 5.2; L.y[n] = (r() - .5) * 3.4; L.z[n] = -.6 + r() * 2.2; L.seed[n] = r() * TAU;
          L.col[n] = BLUE[4 + Math.floor(r() * 3)]; L.sty[n] = 0; L.size[n] = .45 + r() * .4; L.a[n] = .14 + r() * .14;
        }
      }
      finishMap(L);
      return L;
    }
    // Flagged stage timing: the beam sweeps for SCAN_D seconds, then the unflagged transcripts recede.
    const SCAN0 = .4, SCAN_D = 1.55, REC0 = 2.05, REC_D = 1.0;
    const scanPhi = t => mix(wall.phiMin - .16, wall.phiMax + .16, clamp((t - SCAN0) / SCAN_D));
    // Priority layout, no text: three tiers as rows of a left-aligned list (one case, then two, then two).
    // Rank reads from order, size and warmth alone.
    const TIER_SC = [1.5, 1.08, .84], IN_GAP = .08, TIER_GAP = .24;
    let rankCache = null;
    function rankPos(j) {
      if (!rankCache) {
        const sc = TIER_SC.map(v => v * (mobile ? 1.08 : 1)), pos = [], rowTop = [];
        let y = 0;
        for (let t = 0; t < 3; t++) { if (t) y -= TIER_GAP; rowTop.push(y); y -= CH * sc[t]; }
        const mid = y / 2;
        const seen = [0, 0, 0];
        for (let q = 0; q < 5; q++) {
          const t = TIERS[q] - 1, n = seen[t]++, w = CW * sc[t];
          pos.push({ x: n * (w + IN_GAP) + w / 2, y: rowTop[t] - CH * sc[t] / 2 - mid, sc: sc[t] });
        }
        rankCache = pos;
      }
      return rankCache[j];
    }
    function cardAt(s, variant, out) {
      const k = CD.card[s];
      out.col = CD.col[s]; out.sty = CD.sty[s]; out.size = CD.size[s]; out.a = CD.a[s]; out.col2 = -1; out.w2 = 0;
      if (k < 0) {
        const sd = CD.seed[s];
        out.x = CD.x[s] + Math.sin(clock * .13 + sd) * .06; out.y = CD.y[s] + Math.sin(clock * .17 + sd * 2) * .05; out.z = CD.z[s];
        if (variant === 2) out.a *= .45;
        return;
      }
      const cd = cards[k], type = CD.type[s];
      const phi = cd.phi, sp = Math.sin(phi), cp = Math.cos(phi);
      let cx = RC * sp, cy = cd.y, cz = RC * (1 - cp), tx = cp, tz = sp, nx = sp, nz = -cp;
      let off = Math.sin(clock * .7 + cd.seed) * .012, sc = 1;
      if (variant === 1) {
        const scanned = clamp((scanPhi(st) - phi) / .09);
        if (cd.flag >= 0) {
          const f = easeOut(scanned);
          off += .3 * f;
          out.col2 = type === 0 ? AMBER[3] : type === 1 ? AMBER[2] : AMBER[0]; out.w2 = f;
          out.size *= 1 + .22 * f; out.a = mix(out.a, type === 2 ? .55 : 1, f);
        } else {
          const rec = ease(clamp((st - REC0) / REC_D));
          out.a *= mix(1, .6, scanned) * mix(1, type === 2 ? .2 : .28, rec);
          off -= .26 * rec;
        }
      } else if (variant === 2) {
        if (cd.flag >= 0) {
          const j = cd.flag, pos = rankPos(j), lvl = TIERS[j] - 1;
          cx = (mobile ? -.32 : -.08) + pos.x; cy = pos.y; cz = -.2; tx = 1; tz = 0; nx = 0; nz = -1; sc = pos.sc; off = Math.sin(clock * .8 + j) * .012;
          out.col = lvl === 0 ? (type === 0 ? RED[3] : type === 1 ? RED[2] : RED[0]) : type === 0 ? AMBER[[3, 2, 1][lvl]] : type === 1 ? AMBER[[2, 1, 0][lvl]] : AMBER[0];
          out.a = (type === 2 ? [.55, .38, .26] : [1, .84, .66])[lvl];
          out.size *= (.62 + .38 * sc) * [1.2, 1.02, .95][lvl];
        } else { off = -.8; out.a *= type === 2 ? .04 : .06; }
      }
      const lx = CD.lx[s] * sc, ly = CD.ly[s] * sc;
      out.x = cx + lx * tx + nx * off; out.y = cy + ly; out.z = cz + lx * tz + nz * off;
    }

    /* ---------- camera and projection ---------- */
    const atmosW = [0, 0, 0, 0, 0];
    function camGoal(k) { return mobile ? Object.assign({}, STAGES[k].cam, MOBILE_CAM[k]) : STAGES[k].cam; }
    function atmos() {
      project(0, 0, 0, pj); if (!pj.v) return;
      for (let q = 0; q < 5; q++) {
        const w = atmosW[q]; if (w < .01) continue;
        const [rgb, a, rr] = ATMOS[q], rad = F * rr, gx = q >= 2 ? CX + (mobile ? 0 : W * .02) : pj.x, gy = q >= 2 ? CY : pj.y;
        const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, rad);
        gr.addColorStop(0, `rgba(${rgb},${a * w})`); gr.addColorStop(.45, `rgba(${rgb},${a * w * .35})`); gr.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = gr; ctx.globalAlpha = 1; ctx.fillRect(gx - rad, gy - rad, rad * 2, rad * 2);
      }
    }
    function setCamTrig() { cyaw = Math.cos(eff.yaw); syaw = Math.sin(eff.yaw); cpit = Math.cos(eff.pitch); spit = Math.sin(eff.pitch); crol = Math.cos(eff.roll); srol = Math.sin(eff.roll); }
    function project(x, y, z, out) {
      x -= eff.tx; y -= eff.ty; z -= eff.tz;
      const x1 = x * cyaw - z * syaw, z1 = x * syaw + z * cyaw;
      const y1 = y * cpit - z1 * spit, z2 = y * spit + z1 * cpit;
      const zz = z2 + eff.dist;
      if (zz < .25) { out.v = false; return; }
      const xr = x1 * crol - y1 * srol, yr = x1 * srol + y1 * crol, s = F / zz;
      out.x = CX + xr * s; out.y = CY - yr * s; out.s = s; out.z = zz; out.v = true;
    }

    /* ---------- backdrop ---------- */
    function buildBackdrop() {
      const c = document.createElement('canvas'), bw = W * 1.12, bh = H * 1.12;
      c.width = Math.round(bw * DPR); c.height = Math.round(bh * DPR);
      const g = c.getContext('2d'); g.scale(DPR, DPR);
      const m = Math.min(W, H), bx = CX + W * .06, by = CY + H * .06;
      const neb = (x, y, rad, rgb, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(0, 0, bw, bh); };
      neb(bx, by, m * .75, '34,74,128', .2);
      neb(bx + m * .42, by - m * .3, m * .55, '84,66,168', .08);
      neb(bx - m * .5, by + m * .36, m * .5, '26,104,134', .07);
      const r = rng(99), count = Math.round(bw * bh / 1300);
      for (let n = 0; n < count; n++) {
        const x = r() * bw, y = r() * bh, mag = Math.pow(r(), 3.2), size = .25 + mag * 1.25;
        const tint = r(), rgb = tint < .7 ? '210,228,255' : tint < .9 ? '255,240,220' : '170,190,255';
        g.globalAlpha = .18 + .62 * mag + r() * .12; g.fillStyle = `rgb(${rgb})`;
        g.beginPath(); g.arc(x, y, size, 0, TAU); g.fill();
        if (mag > .78) {
          g.globalAlpha = .25 * mag; g.strokeStyle = `rgb(${rgb})`; g.lineWidth = .6; const L = 4 + mag * 9;
          g.beginPath(); g.moveTo(x - L, y); g.lineTo(x + L, y); g.moveTo(x, y - L); g.lineTo(x, y + L); g.stroke();
        }
      }
      g.globalAlpha = 1;
      backdrop = c;
    }

    /* ---------- state ---------- */
    function alloc() {
      const f = () => new Float32Array(N);
      [X, Y, Z, A, S, FX, FY, FZ, FA, FS, AX, AY, AZ, DEL] = Array.from({ length: 14 }, f);
      COL = new Uint8Array(N); STY = new Uint8Array(N); FCOL = new Uint8Array(N); FSTY = new Uint8Array(N);
      const r = rng(3), g = gaussian(r);
      for (let i = 0; i < N; i++) { let ax = g(), ay = g(), az = g(); const l = Math.hypot(ax, ay, az) || 1, m = .4 + r() * .9; AX[i] = ax / l * m; AY[i] = ay / l * m; AZ[i] = az / l * m; }
    }
    function target(i, out) {
      switch (stage) {
        case 0: markAt(C.map[i], out); break;
        case 1: helixAt(HX.map[i], out); break;
        default: cardAt(CD.map[i], stage - 2, out);
      }
    }
    function keyOf(i) { return stage === 0 ? C.key[C.map[i]] : stage === 1 ? HX.key[HX.map[i]] : CD.key[CD.map[i]]; }
    function setDelays() {
      for (let i = 0; i < N; i++) {
        const key = keyOf(i);
        const spread = STAGES[stage].spread ?? (stage === 2 ? .9 : 1);
        if (stage === 0 || stage === 1) DEL[i] = Math.abs(key - .5) * spread;
        else if (stage === 2) DEL[i] = prevStage <= 1 ? key * spread : 0;
        else if (stage === 4) { const k = CD.card[CD.map[i]]; DEL[i] = k >= 0 && cards[k].flag >= 0 ? .1 + cards[k].flag * .12 : 0; }
        else DEL[i] = 0;
      }
    }
    function enter(k, instant) {
      prevStage = stage; stage = k; st = 0;
      FX.set(X); FY.set(Y); FZ.set(Z); FA.set(A); FS.set(S); FCOL.set(COL); FSTY.set(STY);
      Object.assign(camFrom, camBase);
      const S0 = STAGES[k];
      TR = k === 3 && prevStage === 4 ? 1.6 : S0.tr; ARC = S0.arc;
      if (instant) TR = 0;
      C0 = instant ? .3 : 1.75;
      setDelays();
    }

    /* ---------- frame ---------- */
    function frame(dt, instant) {
      clock += dt; st += dt;
      const S0 = STAGES[stage], ce = instant ? 1 : ease(clamp(st / CAM_T)), goal = camGoal(stage);
      for (const key in camBase) camBase[key] = mix(camFrom[key], goal[key], ce);
      atmosW[stage] = ce; for (let q = 0; q < atmosW.length; q++) if (q !== stage) atmosW[q] = Math.min(atmosW[q], 1 - ce);
      ptr.x += (ptr.tx - ptr.x) * Math.min(1, dt * 2.5); ptr.y += (ptr.ty - ptr.y) * Math.min(1, dt * 2.5);
      Object.assign(eff, camBase);
      if (!reduce.matches) { eff.yaw += Math.sin(clock * .11) * .035 + ptr.x * .1; eff.pitch += Math.sin(clock * .083) * .018 + ptr.y * .05; }
      setCamTrig();

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      if (backdrop) ctx.drawImage(backdrop, -W * .06 - eff.yaw * 24, -H * .06 + eff.pitch * 14, W * 1.12, H * 1.12);
      // a handful of stars twinkle slowly
      for (let q = 0; q < twinkle.length; q++) {
        const t = twinkle[q], v = Math.pow(Math.max(0, Math.sin(clock * t[3] + t[4])), 6);
        if (v < .02) continue;
        ctx.globalAlpha = v * .85; ctx.fillStyle = '#dcecff';
        const x = t[0] * W - eff.yaw * 24, y = t[1] * H + eff.pitch * 14, L = t[2] * (2 + 5 * v);
        ctx.fillRect(x - L, y - .4, L * 2, .8); ctx.fillRect(x - .4, y - L, .8, L * 2);
        ctx.beginPath(); ctx.arc(x, y, .9 + v * .6, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;

      const cardStage = stage >= 2, nCards = cards.length;
      if (cardStage) { bx0.fill(1e9); by0.fill(1e9); bx1.fill(-1e9); by1.fill(-1e9); }
      ctx.globalCompositeOperation = 'lighter';
      atmos();
      for (let i = 0; i < N; i++) {
        target(i, o);
        const p = TR ? ease(clamp((st - DEL[i]) / TR)) : 1;
        let x = o.x, y = o.y, z = o.z, a = o.a, size = o.size;
        if (p < 1) {
          const arc = Math.sin(Math.PI * p) * ARC;
          x = mix(FX[i], x, p) + AX[i] * arc; y = mix(FY[i], y, p) + AY[i] * arc; z = mix(FZ[i], z, p) + AZ[i] * arc;
          a = mix(FA[i], a, p); size = mix(FS[i], size, p);
        }
        X[i] = x; Y[i] = y; Z[i] = z; A[i] = a; S[i] = size;
        const tcol = o.col2 >= 0 && o.w2 > .5 ? o.col2 : o.col;
        COL[i] = p < .5 ? FCOL[i] : tcol; STY[i] = p < .5 ? FSTY[i] : o.sty;
        project(x, y, z, pj);
        if (!pj.v) continue;
        const depth = eff.dist / pj.z, fog = clamp(.35 + .75 * depth * depth, .12, 1.15);
        const alpha = a * fog;
        if (alpha < .012) continue;
        const rad = size * R0 * depth;
        if (cardStage && o.sty === 1) {
          const k = CD.card[CD.map[i]];
          if (k >= 0 && CD.type[CD.map[i]] < 2) { if (pj.x < bx0[k]) bx0[k] = pj.x; if (pj.x > bx1[k]) bx1[k] = pj.x; if (pj.y < by0[k]) by0[k] = pj.y; if (pj.y > by1[k]) by1[k] = pj.y; }
        }
        if (p < 1 && (FCOL[i] !== tcol || FSTY[i] !== o.sty)) {
          dot(FSTY[i], FCOL[i], pj.x, pj.y, rad, alpha * (1 - p));
          dot(o.sty, tcol, pj.x, pj.y, rad, alpha * p);
        } else if (o.col2 >= 0 && o.w2 > 0 && o.w2 < 1) {
          dot(o.sty, o.col, pj.x, pj.y, rad, alpha * (1 - o.w2));
          dot(o.sty, o.col2, pj.x, pj.y, rad, alpha * o.w2);
        } else dot(o.sty, tcol, pj.x, pj.y, rad, alpha);
      }
      ctx.globalAlpha = 1;
      if (cardStage && nCards) overlays();
      lineFade = stage === 0 ? 1 : lineFade * Math.exp(-dt * 7);
      if (lineFade > .01) markOverlay();
      ctx.globalCompositeOperation = 'source-over';
    }
    function dot(sty, col, x, y, rad, alpha) {
      const h = rad * SPRITE_K[sty];
      if (h < .35) return;
      ctx.globalAlpha = alpha > 1 ? 1 : alpha;
      ctx.drawImage(SPRITES[sty][col], x - h, y - h, h * 2, h * 2);
    }

    function brackets(x0, y0, x1, y1, a) {
      const k = Math.min(14, (x1 - x0) * .28);
      ctx.globalAlpha = a; ctx.beginPath();
      ctx.moveTo(x0, y0 + k); ctx.lineTo(x0, y0); ctx.lineTo(x0 + k, y0);
      ctx.moveTo(x1 - k, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + k);
      ctx.moveTo(x1, y1 - k); ctx.lineTo(x1, y1); ctx.lineTo(x1 - k, y1);
      ctx.moveTo(x0 + k, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - k);
      ctx.stroke();
    }
    function overlays() {
      const pad = mobile ? 4 : 8;
      if (stage === 3) {
        // scan beam: a vertical sheet of light sweeping along the wall
        const phi = scanPhi(st), on = clamp((st - SCAN0) / .25) * (1 - clamp((st - SCAN0 - SCAN_D + .1) / .35));
        if (on > 0) {
          const top = [], bot = [];
          for (const d of [0, -.16]) {
            const ph = phi + d, x = RC * Math.sin(ph), z = RC * (1 - Math.cos(ph));
            project(x, wall.h / 2 + .1, z, pj); top.push([pj.x, pj.y]);
            project(x, -wall.h / 2 - .1, z, pj); bot.push([pj.x, pj.y]);
          }
          ctx.globalCompositeOperation = 'lighter';
          const gr = ctx.createLinearGradient(top[1][0], 0, top[0][0], 0);
          gr.addColorStop(0, 'rgba(110,190,240,0)'); gr.addColorStop(1, `rgba(110,190,240,${.16 * on})`);
          ctx.globalAlpha = 1; ctx.fillStyle = gr;
          ctx.beginPath(); ctx.moveTo(top[1][0], top[1][1]); ctx.lineTo(top[0][0], top[0][1]); ctx.lineTo(bot[0][0], bot[0][1]); ctx.lineTo(bot[1][0], bot[1][1]); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = `rgba(200,235,255,${.9 * on})`; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); ctx.lineTo(bot[0][0], bot[0][1]); ctx.stroke();
          ctx.strokeStyle = `rgba(120,200,245,${.25 * on})`; ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(top[0][0], top[0][1]); ctx.lineTo(bot[0][0], bot[0][1]); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.strokeStyle = 'rgb(247,196,108)'; ctx.lineWidth = 1.3;
        wall.flagged.forEach(k => {
          if (k < 0 || bx1[k] < bx0[k]) return;
          const f = easeOut(clamp((scanPhi(st) - cards[k].phi) / .09));
          if (f <= 0) return;
          const grow = (1 - f) * 10 + pad;
          brackets(bx0[k] - grow, by0[k] - grow, bx1[k] + grow, by1[k] + grow, f);
        });
        ctx.globalAlpha = 1;
      } else if (stage === 4) {
        // No labels: a warm glow behind the top case, and a thin scale running from hot to cool.
        const a = easeOut((st - .9) / .8);
        if (a <= 0) return;
        const items = wall.flagged.map((k, j) => ({ k, j, x0: bx0[k], y0: by0[k], x1: bx1[k], y1: by1[k] })).filter(b => b.k >= 0 && b.x1 > b.x0);
        if (items.length < 5) return;
        const top = items[0], cx0 = (top.x0 + top.x1) / 2, cy0 = (top.y0 + top.y1) / 2, rad = Math.max(top.x1 - top.x0, top.y1 - top.y0) * 1.1;
        ctx.globalCompositeOperation = 'lighter';
        const gl = ctx.createRadialGradient(cx0, cy0, 0, cx0, cy0, rad);
        gl.addColorStop(0, `rgba(242,75,80,${.22 * a})`); gl.addColorStop(.5, `rgba(242,75,80,${.075 * a})`); gl.addColorStop(1, 'rgba(242,75,80,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = gl; ctx.fillRect(cx0 - rad, cy0 - rad, rad * 2, rad * 2);
        ctx.globalCompositeOperation = 'source-over';
        // Rail: one line down the left of the list, warm at the top and cool at the bottom, with a node per tier.
        const rows = [0, 1, 2].map(t => items.filter(b => TIERS[b.j] === t + 1));
        const x = Math.min(...items.map(b => b.x0)) - (mobile ? 16 : 30), y0 = top.y0, y1 = Math.max(...rows[2].map(b => b.y1));
        const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, `rgba(242,75,80,${.9 * a})`); g.addColorStop(.45, `rgba(247,196,108,${.65 * a})`); g.addColorStop(1, `rgba(120,150,180,${.2 * a})`);
        ctx.fillStyle = g; ctx.fillRect(x - .6, y0, 1.2, y1 - y0);
        const nodeCol = ['242,75,80', '240,180,96', '170,170,170'], nodeR = mobile ? [4, 3.2, 2.6] : [5, 4, 3.2];
        rows.forEach((row, t) => {
          const cy = (Math.min(...row.map(b => b.y0)) + Math.max(...row.map(b => b.y1))) / 2;
          ctx.globalAlpha = a; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, cy, nodeR[t] + 3, 0, TAU); ctx.fill();
          ctx.fillStyle = `rgba(${nodeCol[t]},${[1, .8, .6][t]})`; ctx.beginPath(); ctx.arc(x, cy, nodeR[t], 0, TAU); ctx.fill();
          if (!t) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * .35; ctx.beginPath(); ctx.arc(x, cy, nodeR[t] * 2.4, 0, TAU); ctx.fill(); ctx.globalCompositeOperation = 'source-over'; }
          ctx.globalAlpha = a * [1, .85, .7][t]; ctx.font = labelFont; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          ctx.fillStyle = `rgb(${['255,110,112', '240,196,128', '170,178,188'][t]})`;
          ctx.fillText('Priority ' + (t + 1), x - nodeR[t] - (mobile ? 9 : 14), cy);
        });
        ctx.globalAlpha = 1;
      }
    }

    // Constellation extras, drawn flat over the particles: a hairline along each stroke, light spikes on the stars,
    // a ring as each star lights, and a breathing glow on the apex. Lines follow the stars as they fly off to the helix.
    const SP = Array.from({ length: 14 }, () => ({ x: 0, y: 0, s: 1, v: false }));
    function markOverlay() {
      const t = stage === 0 ? st - C0 : 99, fade = lineFade;
      for (let j = 0; j < 13; j++) { const i = C.inv[C.centre[j]]; project(X[i], Y[i], Z[i], pj); Object.assign(SP[j], pj); }
      SP[13].x = (SP[6].x + SP[7].x) / 2; SP[13].y = (SP[6].y + SP[7].y) / 2; SP[13].v = SP[6].v && SP[7].v;
      ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      for (const [a, b, t0, d] of STROKES) {
        const f = clamp((t - t0) / d); if (f <= 0 || !SP[a].v || !SP[b].v) continue;
        const A = SP[a], B = SP[b], x = mix(A.x, B.x, f), y = mix(A.y, B.y, f);
        ctx.globalAlpha = .1 * fade; ctx.strokeStyle = 'rgb(124,200,236)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(x, y); ctx.stroke();
        ctx.globalAlpha = .32 * fade; ctx.strokeStyle = 'rgb(190,228,250)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(x, y); ctx.stroke();
      }
      const unit = F / 600;
      for (let j = 0; j < 13; j++) {
        const P = SP[j]; if (!P.v) continue;
        const on = easeOut((t - starT[j] + .1) / .35); if (on <= 0) continue;
        const apex = !j, L = (apex ? 30 : 15 + (j * 7 % 5) * 2) * unit * on * (stage === 0 ? 1 : fade);
        const col = apex ? '124,200,236' : '220,236,255';
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const gr = ctx.createLinearGradient(P.x - dx * L, P.y - dy * L, P.x + dx * L, P.y + dy * L);
          gr.addColorStop(0, `rgba(${col},0)`); gr.addColorStop(.5, `rgba(${col},${(apex ? .75 : .45) * fade})`); gr.addColorStop(1, `rgba(${col},0)`);
          ctx.globalAlpha = 1; ctx.strokeStyle = gr; ctx.lineWidth = apex ? 1.2 : .8;
          ctx.beginPath(); ctx.moveTo(P.x - dx * L, P.y - dy * L); ctx.lineTo(P.x + dx * L, P.y + dy * L); ctx.stroke();
        }
        const rp = (t - starT[j] - .05) / .9;
        if (rp > 0 && rp < 1 && !reduce.matches) {
          ctx.globalAlpha = (1 - rp) * (1 - rp) * .5 * fade; ctx.strokeStyle = `rgb(${col})`; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(P.x, P.y, (6 + 34 * easeOut(rp)) * unit * (apex ? 1.4 : 1), 0, TAU); ctx.stroke();
        }
        if (apex) {
          const br = (.8 + .2 * Math.sin(clock * 1.3)) * on * fade, rad = 70 * unit;
          const gl = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, rad);
          gl.addColorStop(0, `rgba(124,200,236,${.3 * br})`); gl.addColorStop(.35, `rgba(124,200,236,${.08 * br})`); gl.addColorStop(1, 'rgba(124,200,236,0)');
          ctx.globalAlpha = 1; ctx.fillStyle = gl; ctx.fillRect(P.x - rad, P.y - rad, rad * 2, rad * 2);
        }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }

    /* ---------- loop and lifecycle ---------- */
    function tick(now) {
      raf = 0;
      const dt = last ? Math.min(.05, (now - last) / 1000) : .016; last = now;
      frame(dt, false);
      schedule();
    }
    function schedule() { if (!raf && visible && !document.hidden && !reduce.matches && N) raf = requestAnimationFrame(tick); }
    function still() { st = stage === 3 ? 4.5 : stage === 4 ? 3 : stage === 0 ? C0 + DRAWN + 1 : 0; TR = 0; frame(0, true); }

    function init() {
      cancelAnimationFrame(raf); raf = 0; last = 0;
      const rect = canvas.getBoundingClientRect();
      W = Math.max(240, rect.width); H = Math.max(240, rect.height);
      DPR = Math.min(devicePixelRatio || 1, 1.75);
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      mobile = W < 700;
      N = mobile ? 2300 : 4800;
      // Centre and size the scene to the free area beside the text; opts.safe() gives its edges in canvas pixels.
      const sa = !mobile && opts.safe ? opts.safe() : null;
      const left = sa ? clamp(sa.left, 0, W - 240) : 0, right = sa ? clamp(sa.right, left + 240, W) : W;
      CX = (left + right) / 2;
      CY = H * (mobile ? .5 : .52);
      F = mobile ? Math.min(W * 1.12, H * 1.2) : Math.min((right - left) * FIT, H * 1.1);
      R0 = mobile ? 1.0 : clamp(F / 660, 1.0, 1.5);
      if (!SPRITES) SPRITES = [PAL.map(c => sprite(c, false)), PAL.map(c => sprite(c, true))];
      alloc();
      C = buildMark(); HX = buildHelix(); CD = buildCards();
      bx0 = new Float32Array(cards.length); by0 = new Float32Array(cards.length); bx1 = new Float32Array(cards.length); by1 = new Float32Array(cards.length);
      buildBackdrop();
      { const r = rng(404); twinkle = Array.from({ length: mobile ? 24 : 54 }, () => [r(), r(), .6 + r() * .9, .25 + r() * .5, r() * TAU]); }
      Object.assign(camBase, camGoal(stage)); Object.assign(camFrom, camBase); atmosW.fill(0); atmosW[stage] = 1;
      // place every particle at its current stage position
      for (let i = 0; i < N; i++) { target(i, o); X[i] = o.x; Y[i] = o.y; Z[i] = o.z; A[i] = o.a; S[i] = o.size; COL[i] = o.col; STY[i] = o.sty; }
      enter(stage, true);
      if (reduce.matches) still(); else { frame(0, false); schedule(); }
    }

    let resizeTimer = 0, lastSize = '';
    new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect(), key = Math.round(r.width) + 'x' + Math.round(r.height);
      if (key === lastSize) return; lastSize = key; clearTimeout(resizeTimer); resizeTimer = setTimeout(init, 160);
    }).observe(canvas);
    new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible) { last = 0; schedule(); } }).observe(canvas);
    document.addEventListener('visibilitychange', () => { last = 0; schedule(); });
    reduce.addEventListener('change', init);
    addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      ptr.tx = (e.clientX / innerWidth - .5) * 2; ptr.ty = (e.clientY / innerHeight - .5) * 2;
    }, { passive: true });
    (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { lastSize = Math.round(canvas.getBoundingClientRect().width) + 'x' + Math.round(canvas.getBoundingClientRect().height); init(); });

    return {
      goTo(k) {
        if (k === stage || !STAGES[k]) return;
        if (!N) { stage = k; return; }
        enter(k, false);
        if (reduce.matches) still(); else schedule();
      },
      get stage() { return stage; },
      stages: STAGES.map(s => s.name)
    };
  }

  window.AstralScroll = { create };
})();
