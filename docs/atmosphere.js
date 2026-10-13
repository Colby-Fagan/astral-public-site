/* Decorative, synthetic data. No user data or network requests. */
(() => {
  const canvas = document.querySelector('#data-atmosphere');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const approach = document.querySelector('.system-overview');
  const contact = document.querySelector('#contact');
  const paletteMode = new URLSearchParams(location.search).get('dots') === 'silver' ? 'silver' : 'risk';
  const densityMode = new URLSearchParams(location.search).get('density') === 'gradient' ? 'gradient' : 'uniform';
  canvas.dataset.palette = paletteMode;
  canvas.dataset.density = densityMode;
  const riskStops = [[0,[183,193,204]],[.35,[204,174,183]],[.65,[226,135,145]],[1,[242,75,80]]];
  const palette = Array.from({length:13},(_,index)=>{
    const value=index/12;
    for(let i=1;i<riskStops.length;i++){
      const [end,b]=riskStops[i],[start,a]=riskStops[i-1];
      if(value<=end)return a.map((v,j)=>Math.round(v+(b[j]-v)*(value-start)/(end-start)));
    }
  });
  let width = 0, height = 0, frame = 0, lastPaint = 0, elapsed = 0;
  let layoutDirty = true, flow = 0, orbit = 0, targetFlow = 0, targetOrbit = 0, scroll = 0, targetScroll = 0;
  let pointer = null, seed = 921;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const clamp = n => Math.max(0, Math.min(1, n));
  const smooth = n => { const t = clamp(n); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a + (b - a) * t;
  function distributeX(u) {
    if(densityMode === 'uniform')return u;
    // Invert a smooth density curve: 1.7 at each edge and .3 at the center.
    // A cosine taper avoids separate bands or an empty central strip.
    let low=0,high=1;
    for(let i=0;i<18;i++){
      const mid=(low+high)/2;
      const cumulative=mid+.7*Math.sin(2*Math.PI*mid)/(2*Math.PI);
      if(cumulative<u)low=mid;else high=mid;
    }
    return (low+high)/2;
  }
  const particles = Array.from({ length: 4200 }, () => {
    const riskRank=random();
    // About 90% silver; the warmer tail spans the palette, with about 1% red.
    const risk=riskRank<.9?0:Math.pow((riskRank-.9)/.1,1.5);
    return {u:distributeX(random()),v:random(),depth:random(),radius:.4+random()*.75,
      phase:random()*Math.PI*2,color:Math.round(risk*12),ox:0,oy:0};
  });
  const paused = () => reducedMotion.matches;

  function layout() {
    if (!paused()) {
      targetFlow = smooth((height * .95 - approach.getBoundingClientRect().top) / (height * .65));
      targetOrbit = smooth((height * .95 - contact.getBoundingClientRect().top) / (height * .65));
      targetScroll = scrollY;
    }
    layoutDirty = false;
  }

  function draw(dt = 0) {
    if (layoutDirty) layout();
    const morph = 1 - Math.exp(-dt * 5);
    flow = mix(flow, targetFlow, morph); orbit = mix(orbit, targetOrbit, morph);
    scroll = mix(scroll, targetScroll, morph);
    canvas.dataset.scene = orbit > .5 ? 'orbit' : flow > .5 ? 'flow' : 'field';
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const alphaSteps = 16;
    const bins = Array.from({ length: (paletteMode === 'silver' ? 1 : palette.length) * alphaSteps }, () => []);
    const halos = [];
    const count = width < 760 ? 1600 : particles.length;
    const follow = 1 - Math.exp(-dt * 7);
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      // Edge wrapping keeps the chosen density profile continuous as slow
      // waves and parallax move the field.
      let y = ((p.v * (height + 40) + elapsed * (1.4 + p.depth * 3) + scroll * p.depth * .05) % (height + 40)) - 20;
      const wave = Math.sin(y / height * 7 + elapsed * .12) * (5 + flow * 13)
        + Math.sin(y / height * 4 + elapsed * .08 + p.phase) * (3 + orbit * 14);
      let x = ((p.u * (width + 40) + wave) % (width + 40) + width + 40) % (width + 40) - 20;
      let tx = 0, ty = 0, proximity = 0;
      if (pointer && !paused()) {
        const dx = x - pointer.x, dy = y - pointer.y, distance = Math.hypot(dx, dy);
        proximity = Math.max(0, 1 - distance / 165);
        const force = proximity * proximity * 42;
        tx = dx / Math.max(distance, 1) * force;
        ty = dy / Math.max(distance, 1) * force;
      }
      p.ox += (tx - p.ox) * follow; p.oy += (ty - p.oy) * follow;
      x += p.ox; y += p.oy;
      const warmth = paletteMode === 'risk' ? smooth((p.color - 5) / 7) : 0;
      const alpha = Math.min(.96, .20 + p.depth * .32 + proximity * .20 + warmth * .48);
      const radius = p.radius * 1.15 + .12 + proximity * .35 + warmth * .95;
      const bin = Math.min(alphaSteps - 1, Math.floor(alpha * alphaSteps));
      bins[bin + (paletteMode === 'silver' ? 0 : p.color * alphaSteps)].push([x, y, radius]);
      if(warmth > .35 && x > -12 && x < width + 12)halos.push({x,y,radius,color:palette[p.color],warmth});
    }
    // A soft color gradient makes the rare warm points legible throughout.
    // Their frequency and positions stay identical to the silver variant.
    halos.forEach(({x,y,radius,color,warmth})=>{
      const spread=radius*4.5;
      const glow=ctx.createRadialGradient(x,y,0,x,y,spread);
      glow.addColorStop(0,`rgba(${color.join(',')},${.20*warmth})`);
      glow.addColorStop(.4,`rgba(${color.join(',')},${.07*warmth})`);
      glow.addColorStop(1,`rgba(${color.join(',')},0)`);
      ctx.fillStyle=glow;ctx.fillRect(x-spread,y-spread,spread*2,spread*2);
    });
    bins.forEach((dots, i) => {
      if(!dots.length)return;
      ctx.fillStyle = `rgba(${palette[Math.floor(i/alphaSteps)].join(',')},${((i % alphaSteps) + .5) / alphaSteps})`;
      ctx.beginPath();
      dots.forEach(([x, y, r]) => { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); });
      ctx.fill();
    });
  }

  function tick(now) {
    frame = 0;
    if (paused() || document.hidden) return;
    if (now - lastPaint >= 32) {
      const dt = Math.min((now - lastPaint) / 1000, .06);
      lastPaint = now; elapsed += dt; draw(dt);
    }
    frame = requestAnimationFrame(tick);
  }
  function start() {
    if (!frame && !paused() && !document.hidden) { lastPaint = performance.now(); frame = requestAnimationFrame(tick); }
  }
  function syncMotion() {
    cancelAnimationFrame(frame); frame = 0;
    canvas.dataset.motion = paused() ? 'paused' : 'playing';
    layoutDirty = true;
    if (!paused()) start();
  }
  function resize() {
    width = innerWidth; height = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    layoutDirty = true; draw();
  }
  addEventListener('resize', resize, { passive: true });
  addEventListener('scroll', () => { layoutDirty = true; }, { passive: true });
  addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse') pointer = { x: event.clientX, y: event.clientY };
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pointer = null; });
  reducedMotion.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  resize(); syncMotion();
})();
