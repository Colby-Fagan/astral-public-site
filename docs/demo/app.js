// Local playback reads the prepared astral.local_demo.v1 dataset.
// The formula matches src/astral_prep/demo_risk.py (reduced-additive-2026-09-25).
const ASTRAL_RISK = (() => {
  const VERSION = 'reduced-additive-2026-09-25';
  const VALUES = {
    SC: {1: 0.05, 2: 0.25, 3: 0.50, 4: 0.72, 5: 0.92},
    KC: {0: 0.15, 1: 0.18, 2: 0.20, 3: 0.22, 4: 0.40, 5: 0.60, 6: 0.80, 7: 1.00},
    SP: {0: 0.10, 1: 0.35, 2: 0.65, 3: 0.90},
    JB: {0: 0.05, 1: 0.35, 2: 0.65, 3: 0.95},
  };
  const LEVELS = {
    SC: {1: 'Minimal specialist knowledge', 2: 'Basic knowledge', 3: 'Working scientific knowledge', 4: 'Advanced scientific capability', 5: 'Highest capability category'},
    KC: {0: 'No operational activity identified', 1: 'Developing an idea or plan', 2: 'Obtaining materials or resources', 3: 'Real-world testing and refinement', 4: 'Increasing scale or quantity', 5: 'Preparing a form for use', 6: 'Designing a delivery device', 7: 'Delivery or release'},
    SP: {0: 'No scope of harm identified', 1: 'An individual or specific target', 2: 'A group', 3: 'Mass or indiscriminate harm'},
    JB: {0: 'No attempt identified', 1: 'A basic attempt', 2: 'Use of a prepared prompt to bypass safeguards', 3: "An attempt adapted to the AI's responses"},
  };
  const POINTS = {SC: 21, KC: 9, SP: 25, JB: 15};
  function compute({SC, KC, SP, JB, CA, BD}) {
    const realization = 0.70 * VALUES.SC[SC] + 0.30 * VALUES.KC[KC];
    const parts = {Topic: 10 * CA + 5 * BD, Realization: 30 * realization, Scope: 25 * VALUES.SP[SP], Jailbreaking: 15 * VALUES.JB[JB]};
    return {parts, realization, topic: (2 * CA + BD) / 6, score: parts.Topic + parts.Realization + parts.Scope + parts.Jailbreaking};
  }
  return {VERSION, VALUES, LEVELS, POINTS, compute};
})();

(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const n = (tag, value, cls) => { const el = document.createElement(tag); if (value !== undefined) el.textContent = String(value); if (cls) el.className = cls; return el; };
  const clear = el => el.replaceChildren();
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const fixed = (value, places = 1) => finite(value) ? value.toFixed(places) : '—';
  const seconds = ms => finite(ms) ? (ms / 1000).toFixed(1) + ' s' : '—';
  const money = amount => finite(amount) ? '$' + amount.toFixed(5) : '—';
  const validTurn = value => Number.isInteger(value) && value > 0;
  const labels = {SC: 'Scientific capability', JB: 'Safeguard bypass', KC: 'Kill chain stages', SP: 'Scope'};
  const shortLabels = {SC: 'Capability', JB: 'Bypass', KC: 'Stages', SP: 'Scope'};
  const maxRating = {SC: 5, JB: 3, KC: 7, SP: 3};
  const tier = score => score >= 60 ? 'High' : score >= 40 ? 'Elevated' : score >= 20 ? 'Moderate' : 'Lower';
  const colorStops = [[0,[110,130,150]],[20,[124,200,236]],[40,[244,184,86]],[60,[242,110,100]],[100,[242,75,80]]];
  function riskColor(score) {
    const value = Math.max(0, Math.min(100, finite(score) ? score : 0));
    for (let i = 1; i < colorStops.length; i++) {
      const [end, next] = colorStops[i], [start, prev] = colorStops[i - 1];
      if (value <= end) { const t = (value - start) / (end - start); return 'rgb(' + prev.map((v, k) => Math.round(v + (next[k] - v) * t)).join(',') + ')'; }
    }
    return '#f24b50';
  }
  function segments(value) {
    const wrap = n('span', undefined, 'segments');
    const items = Array.isArray(value) ? value : Array.isArray(value?.segments) ? value.segments : [];
    for (const item of items) {
      if (item?.type === 'text' && typeof item.text === 'string') wrap.append(document.createTextNode(item.text));
      else if (item?.type === 'redacted') {
        const block = n('span', undefined, 'redacted');
        block.setAttribute('role', 'img'); block.setAttribute('aria-label', 'Redacted');
        wrap.append(block);
      }
    }
    if (!wrap.childNodes.length) wrap.append(n('span', 'Redacted', 'muted'));
    return wrap;
  }
  function table(headers, rows) {
    const wrap = n('div', undefined, 'table-wrap'), t = n('table'), head = n('thead'), hr = n('tr'), body = n('tbody');
    headers.forEach(h => hr.append(n('th', h)));
    head.append(hr);
    rows.forEach(values => { const tr = n('tr'); values.forEach(v => tr.append(n('td', v))); body.append(tr); });
    t.append(head, body); wrap.append(t); return wrap;
  }
  function fail(message) { $('error').textContent = message; $('error').hidden = !message; }
  let cases = [], selectedIds = new Set(), shownIds = new Set(), active = null;
  let activeStage = null, tab = 'ranked', playbackToken = 0, playbackStart = 0, playbackElapsed = 0, playbackTimer = null;
  let resultsStarted = false, playbackDone = false, formulaReturn = '';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let cancelStage = null, pipeline = {}, playbackProgress = 0;
  const caseById = id => cases.find(c => c.id === id);
  const displayName = c => c.label;
  const conversationRedacted = c => (c.messages || []).some(message => (message.segments || []).some(segment => segment.type === 'redacted'));
  const redactionBadge = () => n('span', 'Conversation redacted', 'redaction-badge');
  const caseHref = c => '#case-' + c.id;
  const groups = [
    ['ranked','Ranked',''],
    ['keyword','Keyword stops','Stopped at the keyword filter'],
    ['concept','Concept stops','Stopped at the concept filter'],
  ];
  function category(c) {
    if (c.outcome === 'keyword') return 'keyword';
    if (c.outcome === 'concept') return 'concept';
    return c.risk?.status === 'scored' && finite(c.risk?.score) ? 'ranked' : 'unscored';
  }
  function unresolvedDetail(c) {
    if (c.stages?.pathways?.decision === 'error') return 'Pathway assessment failed · unresolved';
    if (c.stages?.ratings?.decision === 'error') return 'Ratings assessment failed · unresolved';
    return c.status === 'error' || c.status === 'failed' ? 'Assessment failed · unresolved' : c.status === 'not_run' || c.status === 'missing' ? 'Assessment missing · unresolved' : 'Assessment unresolved';
  }
  function stageDecision(value, stopped) {
    return ({retain:'Continued',skip:stopped ? 'Stopped' : 'Skipped',uncertain:'Uncertain · continued',error:'Error · continued',not_run:'Not reached'})[value] || (stopped ? 'Stopped' : 'Unavailable');
  }
  function judgeDecision(value) {
    return ({retain:'Completed',error:'Failed · unresolved',uncertain:'Unresolved',not_run:'Not reached'})[value] || 'Unavailable';
  }
  function orderedVisible() {
    const visible = cases.filter(c => shownIds.has(c.id));
    const scored = visible.filter(c => category(c) === 'ranked').sort((a,b) => b.risk.score - a.risk.score || a.id.localeCompare(b.id));
    return scored.concat(...groups.slice(1).map(([key]) => visible.filter(c => category(c) === key)));
  }
  function riskRank(c) {
    const sorted = orderedVisible().filter(row => category(row) === 'ranked');
    const index = sorted.findIndex(row => row.id === c.id);
    return index < 0 ? null : sorted.findIndex(row => row.risk.score === c.risk.score) + 1;
  }
  function selectedCases() { return cases.filter(c => selectedIds.has(c.id)); }
  function renderSelector() {
    const box = $('log-selector'); clear(box);
    [['synthetic', 'Synthetic conversations'], ['real-biology', 'Real conversations (biology)'], ['real-non-biology', 'Real conversations (miscellaneous topics)']].forEach(([key, title]) => {
      const rows = cases.filter(c => c.selectionGroup === key);
      const section = n('fieldset', undefined, 'conversation-group');
      const legend = n('legend', title); legend.append(n('span', rows.length, 'group-count'));
      const grid = n('div', undefined, 'conversation-grid');
      rows.forEach(c => {
        const label = n('label', undefined, 'log-choice'), input = n('input');
        input.type = 'checkbox'; input.value = c.id; input.checked = selectedIds.has(c.id); input.disabled = resultsStarted && !playbackDone;
        input.addEventListener('change', () => { if (input.checked) selectedIds.add(c.id); else selectedIds.delete(c.id); selectorState(); });
        const name = n('span', displayName(c), 'choice-name');
        if (conversationRedacted(c)) name.append(redactionBadge());
        label.append(input, name); grid.append(label);
      });
      section.append(legend, grid); box.append(section);
    });
    selectorState();
  }
  function selectorState() {
    $('selected-count').textContent = selectedIds.size + ' of ' + cases.length + ' selected';
    $('analyze').disabled = selectedIds.size === 0 || resultsStarted && !playbackDone;
    $('analyze').textContent = resultsStarted && playbackDone ? 'Replay saved results' : 'Analyze';
    $('select-all').disabled = $('select-none').disabled = resultsStarted && !playbackDone;
  }
  $('select-all').addEventListener('click', () => { selectedIds = new Set(cases.map(c => c.id)); renderSelector(); });
  $('select-none').addEventListener('click', () => { selectedIds.clear(); renderSelector(); });
  function stopPlayback() {
    playbackToken++;
    if (playbackTimer) cancelAnimationFrame(playbackTimer);
    if (cancelStage) cancelStage(false);
    playbackTimer = cancelStage = null; active = activeStage = null;
  }
  function reset() {
    stopPlayback(); selectedIds = new Set(cases.map(c => c.id)); shownIds.clear(); resultsStarted = playbackDone = false;
    playbackElapsed = 0; tab = 'ranked'; $('results').hidden = true; fail('');
    if (location.hash.startsWith('#case-')) history.replaceState(null, '', location.pathname + location.search);
    renderSelector(); showView();
  }
  $('reset').addEventListener('click', reset);
  function paintPipeline() {
    for (const key of ['keyword','concept','judges']) {
      const state = pipeline[key], node = $('play-' + key);
      if (!state) continue;
      node.className = 'pipeline-stage is-' + state.status;
      node.querySelector('.pipeline-state').textContent = ({waiting:'Waiting',running:'Replaying',complete:'Complete',skipped:'Not reached'})[state.status];
      node.querySelector('.pipeline-detail').textContent = state.status === 'waiting' ? 'Waiting for the previous stage' : state.status === 'skipped' ? 'No conversations continued' : state.checked + ' / ' + state.total + ' reviewed' + (state.status === 'complete' && key !== 'judges' ? ' · ' + state.stopped + ' stopped' : '');
    }
  }
  function playStage(key, records, workBefore, totalWork, run) {
    const state = pipeline[key]; state.status = records.length ? 'running' : 'skipped';
    activeStage = key; paintPipeline();
    if (!records.length) return Promise.resolve(true);
    const duration = reducedMotion.matches ? 500 : Math.max(1400, Math.min(2800, 1000 + records.length * 65));
    const started = performance.now();
    return new Promise(resolve => {
      cancelStage = resolve;
      function tick(now) {
        if (run !== playbackToken) { resolve(false); return; }
        const fraction = Math.max(0, Math.min(1, (now - started) / duration));
        const count = Math.min(records.length, Math.floor(fraction * records.length));
        for (let i = state.checked; i < count; i++) {
          const c = records[i];
          if (key === 'judges' || c.outcome === key) shownIds.add(c.id);
        }
        if (count !== state.checked) { state.checked = count; paintPipeline(); renderResults(); }
        playbackProgress = (workBefore + fraction * records.length) / totalWork;
        $('progress-bar').style.transform = 'scaleX(' + playbackProgress + ')';
        $('progress').setAttribute('aria-valuenow', String(Math.round(playbackProgress * 100)));
        playbackElapsed = Math.max(0, now - playbackStart); $('playback-time').textContent = seconds(playbackElapsed);
        if (fraction < 1) playbackTimer = requestAnimationFrame(tick);
        else { state.status = 'complete'; paintPipeline(); cancelStage = null; playbackTimer = null; resolve(true); }
      }
      playbackTimer = requestAnimationFrame(tick);
    });
  }
  $('analyze').addEventListener('click', async () => {
    if (!selectedIds.size || resultsStarted && !playbackDone) return;
    stopPlayback(); const run = playbackToken;
    shownIds.clear(); resultsStarted = true; playbackDone = false; playbackStart = performance.now(); playbackElapsed = 0; playbackProgress = 0;
    const selected = selectedCases();
    const stages = [['keyword',selected],['concept',selected.filter(c => c.outcome !== 'keyword')],['judges',selected.filter(c => c.outcome === 'judged').sort((a,b) => b.risk.score - a.risk.score || a.id.localeCompare(b.id))]];
    pipeline = Object.fromEntries(stages.map(([key,records]) => [key,{status:'waiting',checked:0,total:records.length,stopped:records.filter(c => c.outcome === key).length}]));
    for (const id of ['funnel','funnel-legend','tabs','case-list']) clear($(id));
    $('case-list').dataset.category = ''; $('progress-bar').style.transform = 'scaleX(0)';
    $('now-playing').hidden = false; paintPipeline();
    $('results').hidden = false; fail(''); renderSelector(); renderResults();
    $('results').scrollIntoView({behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start'});
    const totalWork = stages.reduce((sum,[,records]) => sum + records.length,0);
    let workBefore = 0;
    for (const [key,records] of stages) {
      if (!await playStage(key,records,workBefore,totalWork,run)) return;
      workBefore += records.length;
    }
    if (run !== playbackToken) return;
    playbackElapsed = performance.now() - playbackStart; playbackTimer = null;
    activeStage = null; playbackDone = true; renderSelector(); renderResults();
  });
  function stageState(c, key) {
    const position = ['keyword','concept','judges'].indexOf(key);
    if (active === c.id) {
      const activePosition = ['keyword','concept','judges'].indexOf(activeStage);
      if (position === activePosition) return 'running';
      if (position > activePosition) return 'waiting';
    }
    if (key === 'keyword') return c.outcome === 'keyword' ? 'stop' : ['uncertain','error'].includes(c.stages?.keyword?.decision) ? 'warn' : 'pass';
    if (key === 'concept') return c.outcome === 'keyword' ? 'skip' : c.outcome === 'concept' ? 'stop' : ['uncertain','error'].includes(c.stages?.concept?.decision) ? 'warn' : 'pass';
    return c.outcome !== 'judged' ? 'skip' : category(c) === 'ranked' ? 'pass' : 'warn';
  }
  function stageTrack(c) {
    const track = n('ol', undefined, 'stage-track');
    const stages = [['keyword','Keywords'],['concept','Concepts'],['judges','Judges']];
    track.setAttribute('aria-label', stages.map(([key,label]) => label + ' ' + stageState(c,key)).join(', '));
    stages.forEach(([key,label]) => {
      const state = stageState(c,key), item = n('li', undefined, 'st st-' + state);
      item.append(n('span', undefined, 'st-dot'), n('span', label, 'st-label'));
      if (state === 'stop') item.append(n('span', 'stopped', 'st-note'));
      if (state === 'warn') item.append(n('span', 'unresolved', 'st-note'));
      track.append(item);
    });
    return track;
  }
  function riskBadge(score) {
    const box = n('span', undefined, 'risk-badge');
    box.append(n('span', fixed(score), 'risk-num'));
    const caption = n('span', undefined, 'risk-tier'); caption.append(n('strong', tier(score)), n('span', 'risk / 100'));
    box.append(caption); return box;
  }
  function ratingSummary(c) {
    const line = n('span', undefined, 'rating-line');
    for (const key of ['SC','JB','KC','SP']) {
      const record = (c.ratings || []).find(r => r.key === key);
      if (!record) continue;
      const value = record.value;
      line.append(n('span', shortLabels[key] + ' ' + (Array.isArray(value) ? value.join(', ') : value ?? 'unavailable')));
    }
    return line;
  }
  function card(c) {
    const kind = category(c), wrap = n('div', undefined, 'case-card ' + (kind === 'ranked' ? 'scored' : kind === 'unscored' ? 'unscored' : 'stopped ' + (kind === 'concept' ? 'concept' : '')));
    const link = n('a', undefined, 'case'); link.href = caseHref(c); link.setAttribute('aria-label', 'Open report for ' + displayName(c) + (conversationRedacted(c) ? ' · Conversation redacted' : ''));
    const main = n('span', undefined, 'case-main'); main.append(n('span', displayName(c), 'case-name'));
    if (conversationRedacted(c)) main.append(redactionBadge());
    if (kind === 'ranked') main.append(ratingSummary(c));
    else if (kind === 'unscored') main.append(n('span', unresolvedDetail(c) + ' · no score', 'case-sub warn'));
    else if (kind === 'concept') {
      const s = c.stages?.concept?.similarities;
      const cutoff = c.stages?.concept?.cutoff;
      main.append(n('span', s && finite(s.CA) && finite(s.BD) ? 'Highest similarity: CA ' + fixed(s.CA,3) + ' · BD ' + fixed(s.BD,3) + (finite(cutoff) ? ' · cutoff ' + fixed(cutoff,3) : '') : 'Stopped at concept filter', 'case-sub'));
    } else {
      const matches = c.stages?.keyword?.matchedRuleCount;
      const rules = c.stages?.keyword?.ruleCount;
      main.append(n('span', 'Stopped at keyword filter' + (Number.isInteger(matches) ? ' · ' + matches + (Number.isInteger(rules) ? ' of ' + rules : '') + ' rules matched' : ''), 'case-sub'));
    }
    main.append(stageTrack(c));
    if (kind === 'ranked') {
      wrap.style.setProperty('--case-color', riskColor(c.risk.score));
      link.append(n('span', '#' + riskRank(c), 'rank'), main, riskBadge(c.risk.score));
    } else if (kind === 'unscored') link.append(n('span', '—', 'rank'), main, n('span', '›', 'chevron'));
    else link.append(main, n('span', '›', 'chevron'));
    wrap.append(link); return wrap;
  }
  function renderFunnel() {
    const selected = selectedCases(), ordered = orderedVisible();
    const funnel = $('funnel'), legend = $('funnel-legend');
    if (!funnel.childElementCount) {
      selected.forEach(c => {
        const segment = n('button',undefined,'seg pending'); segment.type = 'button'; segment.dataset.id = c.id;
        segment.addEventListener('click', () => { if (shownIds.has(c.id)) location.hash = caseHref(c); });
        funnel.append(segment);
      });
    }
    for (const segment of funnel.children) {
      const c = caseById(segment.dataset.id), complete = shownIds.has(c.id), type = complete ? category(c) : 'pending';
      segment.className = 'seg ' + (type === 'keyword' ? 'kw' : type); segment.disabled = !complete;
      segment.title = displayName(c) + ' · ' + type; segment.setAttribute('aria-label',displayName(c) + ' · ' + type);
      segment.style.backgroundColor = type === 'ranked' ? riskColor(c.risk.score) : '';
    }
    funnel.setAttribute('aria-label',ordered.length + ' of ' + selected.length + ' conversations completed');
    if (!legend.childElementCount) {
      for (const [key,name] of groups) {
        const button = n('button',undefined,'legend-item'); button.type = 'button'; button.dataset.group = key;
        button.append(n('span',undefined,'swatch ' + (key === 'keyword' ? 'kw' : key)),n('strong',0),n('span',name,'label'));
        button.addEventListener('click', () => { tab = key; renderTabs(); }); legend.append(button);
      }
    }
    for (const button of legend.children) button.querySelector('strong').textContent = ordered.filter(c => category(c) === button.dataset.group).length;
  }
  function renderTabs(focusKey) {
    const list = $('tabs'), visible = orderedVisible();
    if (!list.childElementCount) groups.forEach(([key,name]) => {
      const button = n('button',undefined,'tab'); button.type = 'button'; button.id = 'tab-' + key;
      button.setAttribute('role','tab'); button.setAttribute('aria-controls','tab-panel');
      button.append(n('span',name),n('span',0,'count'));
      button.addEventListener('click', () => { tab = key; renderTabs(key); });
      button.addEventListener('keydown', event => {
        const keys = groups.map(item => item[0]), index = keys.indexOf(key);
        const next = event.key === 'ArrowRight' ? keys[(index + 1) % keys.length] : event.key === 'ArrowLeft' ? keys[(index - 1 + keys.length) % keys.length] : event.key === 'Home' ? keys[0] : event.key === 'End' ? keys[keys.length - 1] : null;
        if (next) { event.preventDefault(); tab = next; renderTabs(next); }
      });
      list.append(button);
    });
    for (const [key,,note] of groups) {
      const button = $('tab-' + key); button.setAttribute('aria-selected',String(tab === key)); button.tabIndex = tab === key ? 0 : -1;
      button.querySelector('.count').textContent = visible.filter(c => category(c) === key).length;
      if (tab === key) { $('tab-panel').setAttribute('aria-labelledby',button.id); $('panel-note').textContent = note; }
    }
    $('ranked-heading').hidden = tab !== 'ranked';
    const panel = $('case-list');
    if (panel.dataset.category !== tab) { clear(panel); panel.dataset.category = tab; }
    const rows = visible.filter(c => category(c) === tab);
    if (rows.length) {
      panel.querySelector('.empty-state')?.remove();
      for (const c of rows) {
        if (panel.querySelector('[data-case-id="' + c.id + '"]')) continue;
        const item = card(c); item.dataset.caseId = c.id; panel.append(item);
      }
    } else {
      let empty = panel.querySelector('.empty-state');
      if (!empty) { empty = n('p',undefined,'empty-state'); panel.append(empty); }
      empty.textContent = playbackDone ? 'No cases in this group.' : tab === 'ranked' ? 'Ranked conversations will appear after the model judges.' : 'Results will appear as this stage completes.';
    }
    if (focusKey) $('tab-' + focusKey).focus();
  }
  function renderResults() {
    const selected = selectedCases(), finished = selected.filter(c => shownIds.has(c.id));
    $('batch-title').textContent = selected.length + ' preloaded ' + (selected.length === 1 ? 'log' : 'logs');
    $('completed').textContent = finished.length + ' / ' + selected.length;
    $('batch-status').textContent = playbackDone ? 'Playback complete · saved results' : 'Replaying saved results';
    $('playback-time').textContent = seconds(playbackElapsed);
    for (const [id,key,formatter] of [['recorded-time','durationMs',seconds],['recorded-cost','costUsd',money]]) {
      const values = finished.map(c => c.recorded?.[key]);
      $(id).textContent = values.length && values.every(finite) ? formatter(values.reduce((a,b) => a + b, 0)) : '—';
    }
    renderFunnel(); renderTabs();
  }
  function evidence(turn) {
    const link = n('a', 'Turn ' + turn, 'evidence'); link.href = '#turn-' + turn;
    link.addEventListener('click', event => {
      event.preventDefault(); const target = $('turn-' + turn);
      if (!target) return;
      $('turns').querySelectorAll('.turn.target').forEach(el => el.classList.remove('target'));
      target.classList.add('target'); target.scrollIntoView({behavior:'smooth',block:'center'}); target.focus({preventScroll:true});
    });
    return link;
  }
  function citeTurns(parent, turns, count) {
    const known = new Set();
    for (const turn of Array.isArray(turns) ? turns : []) {
      if (!validTurn(turn) || turn > count || known.has(turn)) continue;
      known.add(turn); parent.append(evidence(turn));
    }
  }
  function journeyItem(label, state, detail) {
    const item = n('li'); item.append(n('span', undefined, 'dot ' + state), n('strong', label), n('span', detail)); return item;
  }
  function renderReport(c) {
    const nav = orderedVisible(), position = nav.findIndex(row => row.id === c.id);
    $('case-title').textContent = displayName(c); $('report-position').textContent = 'Case ' + (position + 1) + ' of ' + nav.length;
    for (const [id,near] of [['prev',nav[position - 1]],['next',nav[position + 1]]]) {
      const link = $(id); link.href = near ? caseHref(near) : '#'; link.classList.toggle('disabled',!near); link.setAttribute('aria-disabled',String(!near)); link.tabIndex = near ? 0 : -1;
    }
    $('conversation').querySelector('h2').textContent = conversationRedacted(c) ? 'Redacted conversation' : 'Conversation';
    const summary = $('case-summary'); clear(summary);
    const risk = c.risk || {}, kind = category(c);
    if (kind === 'ranked') {
      const hero = n('div', undefined, 'risk-hero'); hero.style.setProperty('--case-color',riskColor(risk.score));
      hero.append(n('span', fixed(risk.score), 'risk-num'));
      const label = n('div', tier(risk.score) + ' risk', 'tier'); label.append(n('span',' · #' + riskRank(c) + ' in review order')); hero.append(label);
      const scale = n('div',undefined,'hero-scale'), marker = n('span',undefined,'marker'); marker.style.left = Math.max(0,Math.min(100,risk.score)) + '%'; scale.append(marker);
      const scaleWrap = n('div'); scaleWrap.append(scale); hero.append(scaleWrap);
      summary.append(hero);
    } else {
      const message = kind === 'keyword' ? 'Stopped at the keyword filter.' : kind === 'concept' ? 'Stopped at the concept filter.' : 'No risk score. ' + unresolvedDetail(c) + '.';
      summary.append(n('p',message,'callout ' + (kind === 'concept' ? 'concept' : kind === 'unscored' ? 'warn' : '')));
    }
    const reportSummary = c.report?.summary;
    if (reportSummary) { const p = n('p',undefined,'segment-line'); p.append(segments(reportSummary)); summary.append(p); }
    const journey = $('journey'); clear(journey);
    journey.append(journeyItem('Keywords',stageState(c,'keyword'),stageDecision(c.stages?.keyword?.decision,kind === 'keyword').toLowerCase()));
    journey.append(journeyItem('Concepts',stageState(c,'concept'),kind === 'keyword' ? 'not reached' : stageDecision(c.stages?.concept?.decision,kind === 'concept').toLowerCase()));
    journey.append(journeyItem('Judges',kind === 'keyword' || kind === 'concept' ? 'skip' : kind === 'ranked' ? 'pass' : 'warn',kind === 'keyword' || kind === 'concept' ? 'not reached' : kind === 'ranked' ? 'scored' : 'unresolved'));
    renderRatings(c); renderPathways(c); renderTechnical(c); renderTurns(c);
  }
  function renderRatings(c) {
    const box = $('variables'); clear(box); $('scores-section').hidden = c.outcome !== 'judged';
    if (c.outcome !== 'judged') return;
    if (!Array.isArray(c.ratings) || !c.ratings.length) { box.append(n('p','Ratings unavailable.','empty-state')); return; }
    for (const key of ['SC','JB','KC','SP']) {
      const rating = c.ratings.find(item => item.key === key); if (!rating) continue;
      const row = n('details',undefined,'rating'), head = n('summary'), body = n('div',undefined,'rating-body');
      const label = n('span',labels[key],'rating-label'); label.append(n('small',key));
      const value = Array.isArray(rating.value) ? rating.value.join(', ') : rating.value ?? 'Unavailable';
      const valueBox = n('span',undefined,'rating-value'); valueBox.append(n('b',value),n('span',finite(value) ? ' / ' + maxRating[key] : ''));
      const level = Array.isArray(rating.level) ? rating.level.join(', ') : rating.level;
      if (typeof level === 'string' && level || Number.isInteger(level)) valueBox.append(n('span',' · ' + level));
      head.append(label,valueBox); row.append(head);
      if (rating.label) { const p = n('p'); p.append(segments(rating.label)); body.append(p); }
      citeTurns(body,rating.turns,c.messages?.length || 0);
      row.append(body); box.append(row);
    }
  }
  function renderPathways(c) {
    const box = $('topic-content'); clear(box); $('topics').hidden = c.outcome !== 'judged';
    if (c.outcome !== 'judged') return;
    const decision = c.stages?.pathways?.decision;
    if (decision === 'error' || decision === 'uncertain' || decision === 'unresolved') { box.append(n('p','Pathway assessment unresolved.','topic-failure')); return; }
    if (!Array.isArray(c.pathways) || !c.pathways.length) { box.append(n('p','No pathway selected.','muted')); return; }
    c.pathways.forEach((pathway,index) => {
      const family = ['CA','BD','RB'].includes(pathway.family) ? pathway.family : 'Unavailable';
      const route = n('article',undefined,'route ' + (index === 0 ? 'route-top ' : '') + (family === 'RB' ? 'benign' : ''));
      const head = n('div',undefined,'route-head');
      const familyNames = {CA:'Dangerous biology',BD:'Dual-use biology',RB:'Benign biology'};
      const name = n('strong',familyNames[family] || family, 'pathway-family');
      if (familyNames[family]) {
        const paper = n('a','(' + family + ')','paper-link');
        paper.href = 'https://arxiv.org/abs/2607.14479'; paper.target = '_blank'; paper.rel = 'noopener noreferrer';
        paper.setAttribute('aria-label',family + ' — BioTIER paper'); name.append(document.createTextNode(' '),paper);
      }
      head.append(name);
      if (pathway.label) head.append(segments(pathway.label)); route.append(head);
      if (pathway.description) { const p = n('p'); p.append(segments(pathway.description)); route.append(p); }
      citeTurns(route,pathway.turns,c.messages?.length || 0); box.append(route);
    });
  }
  function renderTechnical(c) {
    const risk = $('risk-breakdown'), stage = $('stage-details'); clear(risk); clear(stage);
    if (category(c) === 'ranked') {
      risk.append(n('h3','Risk calculation'));
      const f = c.risk?.formula || {};
      risk.append(table(['Component','Points'],[['Topic',fixed(f.topic,2)],['Realization',fixed(f.realization,2)],['Scope',fixed(f.scope,2)],['Jailbreaking',fixed(f.jailbreaking,2)]]));
    }
    stage.append(n('h3','Filters, recorded timing and cost'));
    const keyword = c.stages?.keyword || {}, concept = c.stages?.concept || {}, ratings = c.stages?.ratings || {}, pathways = c.stages?.pathways || {};
    const kwTurns = Array.isArray(keyword.turns) ? keyword.turns.filter(validTurn).join(', ') : '';
    const similarity = concept.similarities || {};
    const timing = stage => finite(stage.durationMs) ? ' · ' + seconds(stage.durationMs) : '';
    stage.append(table(['Stage','Recorded outcome'],[
      ['Keyword filter', stageDecision(keyword.decision,c.outcome === 'keyword') + (Number.isInteger(keyword.matchedRuleCount) ? ' · ' + keyword.matchedRuleCount + (Number.isInteger(keyword.ruleCount) ? ' of ' + keyword.ruleCount : '') + ' rules matched' : '') + (kwTurns ? ' · turn ' + kwTurns : '') + timing(keyword)],
      ['Concept filter', c.outcome === 'keyword' ? 'Not reached' : stageDecision(concept.decision,c.outcome === 'concept') + timing(concept)],
      ['Highest concept similarity', finite(similarity.CA) && finite(similarity.BD) ? 'CA ' + fixed(similarity.CA,3) + ' · BD ' + fixed(similarity.BD,3) : 'Unavailable'],
      ['Highest candidate similarity', finite(concept.candidateMaximum) ? fixed(concept.candidateMaximum,3) : 'Unavailable'],
      ['Concept cutoff', finite(concept.cutoff) ? fixed(concept.cutoff,3) : 'Unavailable'],
      ['Concept sections compared', Number.isInteger(concept.sectionCount) ? concept.sectionCount : 'Unavailable'],
      ['Ratings judge', c.outcome !== 'judged' ? 'Not reached' : judgeDecision(ratings.decision) + timing(ratings)],
      ['Pathway judge', c.outcome !== 'judged' ? 'Not reached' : judgeDecision(pathways.decision) + timing(pathways)],
      ['Risk score', category(c) === 'ranked' ? fixed(c.risk.score) : c.outcome === 'judged' ? 'Unresolved' : 'Not scored'],
      ['Recorded analysis time',seconds(c.recorded?.durationMs)],['Recorded model cost',money(c.recorded?.costUsd)],
    ]));
    if (c.outcome !== 'keyword' && Array.isArray(keyword.turns) && keyword.turns.length) {
      const cited = n('p','Keyword turn references: ','small'); citeTurns(cited,keyword.turns,c.messages?.length || 0); stage.append(cited);
    }
  }
  function renderTurns(c) {
    const box = $('turns'); clear(box);
    (Array.isArray(c.messages) ? c.messages : []).forEach((message,index) => {
      const role = ['user','assistant','tool','system'].includes(message.role) ? message.role : 'message';
      const turn = n('article',undefined,'turn ' + role); turn.id = 'turn-' + (index + 1); turn.tabIndex = -1;
      turn.append(n('h4','Turn ' + (index + 1) + ' · ' + role));
      const body = n('div'); body.append(segments(message.segments)); turn.append(body); box.append(turn);
    });
    if (!box.children.length) box.append(n('p','Conversation unavailable.','muted'));
    const citations = Array.isArray(c.report?.citations) ? c.report.citations : [];
    if (citations.length) {
      const section = n('section',undefined,'citation-list'); section.append(n('h3','Report citations'));
      for (const citation of citations) {
        const item = n('div',undefined,'citation-item');
        if (validTurn(citation.turn) && citation.turn <= (c.messages?.length || 0)) item.append(evidence(citation.turn));
        if (citation.referenceLabel) { const p = n('p'); p.append(segments(citation.referenceLabel)); item.append(p); }
        if (citation.text) { const p = n('p'); p.append(segments(citation.text)); item.append(p); }
        section.append(item);
      }
      box.append(section);
    }
  }
  function showView() {
    const formula = location.hash === '#risk-formula';
    const id = location.hash.match(/^#case-(log-(?:0[1-9]|[12][0-9]|3[0-3]))$/)?.[1];
    const c = id && shownIds.has(id) ? caseById(id) : null;
    $('home-view').hidden = Boolean(formula || c); $('formula-view').hidden = !formula; $('report-view').hidden = !c;
    $('formula-link').setAttribute('aria-current',formula ? 'page' : 'false');
    if (c) renderReport(c);
    return formula ? 'formula' : c ? 'report' : 'home';
  }
  window.addEventListener('hashchange',event => {
    const previous = event.oldURL ? new URL(event.oldURL).hash : '';
    if (location.hash === '#risk-formula' && previous !== '#risk-formula') formulaReturn = previous;
    showView(); window.scrollTo(0,0);
  });
  $('formula-back').addEventListener('click',event => { event.preventDefault(); location.hash = formulaReturn && formulaReturn !== '#risk-formula' ? formulaReturn : ''; });
  $('back').addEventListener('click',event => { event.preventDefault(); location.hash = ''; });
  function buildFormulaPage() {
    const R = ASTRAL_RISK, fmt = v => v.toFixed(2);
    for (const [label,points] of [['Topic',30],['Realization',30],['Scope',25],['Jailbreaking',15]]) {
      const segment = n('span',undefined,'weight-seg'); segment.style.flexGrow = points; segment.append(n('b',points),n('span',label)); $('weight-bar').append(segment);
    }
    const topicRows = [[3,0,'3 CA'],[1,2,'1 CA + 2 BD'],[0,3,'3 BD'],[0,0,'no CA or BD']];
    $('topic-table').append(table(['Selected pathways','Topic value','Points'],topicRows.map(([ca,bd,label]) => [label,fmt((2 * ca + bd) / 6),fmt(10 * ca + 5 * bd)])));
    for (const key of ['SC','KC','SP','JB']) {
      const title = {SC:'Scientific capability',KC:'Kill chain stage',SP:'Scope',JB:'Jailbreaking'}[key], wrap = $('table-' + key);
      wrap.append(n('h3',title));
      wrap.append(table(['Level','Value','Points'],Object.keys(R.VALUES[key]).map(level => [level + ' · ' + R.LEVELS[key][level],fmt(R.VALUES[key][level]),fmt(R.VALUES[key][level] * R.POINTS[key])])));
    }
    const options = {SC:[1,2,3,4,5],KC:[0,1,2,3,4,5,6,7],SP:[0,1,2,3],JB:[0,1,2,3],CA:[0,1,2,3],BD:[0,1,2,3]};
    const defaults = {SC:3,KC:4,SP:1,JB:1,CA:1,BD:2};
    for (const [key,values] of Object.entries(options)) {
      const select = $('calc-' + key);
      values.forEach(value => { const option = n('option',value + (R.LEVELS[key] ? ' · ' + R.LEVELS[key][value] : '')); option.value = value; select.append(option); });
      select.value = defaults[key];
      select.addEventListener('change',() => {
        const other = key === 'CA' ? 'BD' : key === 'BD' ? 'CA' : null;
        if (other && Number($('calc-CA').value) + Number($('calc-BD').value) > 3) $('calc-' + other).value = 3 - Number(select.value);
        updateCalculator();
      });
    }
    updateCalculator(); $('formula-version').textContent = 'Formula version ' + R.VERSION + '.';
  }
  function updateCalculator() {
    const input = Object.fromEntries(['SC','KC','SP','JB','CA','BD'].map(key => [key,Number($('calc-' + key).value)]));
    const result = ASTRAL_RISK.compute(input), box = $('calc-result'); clear(box);
    box.style.setProperty('--case-color',riskColor(result.score)); box.append(riskBadge(result.score));
    const parts = n('div',undefined,'calc-parts');
    for (const [label,points] of Object.entries(result.parts)) { const item = n('span'); item.append(n('b',points.toFixed(2)),n('span',label)); parts.append(item); }
    box.append(parts);
  }
  async function load() {
    try {
      const dataset = window.ASTRAL_DEMO_DATA;
      if (dataset?.schema !== 'astral.local_demo.v1' || !Array.isArray(dataset.cases) || dataset.cases.length !== 30) throw Error('The saved demo data is incomplete.');
      const ids = new Set();
      for (const c of dataset.cases) {
        if (!/^log-(?:0[1-9]|[12][0-9]|3[0-3])$/.test(c.id) || ids.has(c.id) || !['keyword','concept','judged'].includes(c.outcome)) throw Error('The saved demo data is invalid.');
        if (['log-06','log-07','log-08'].includes(c.id) || typeof c.label !== 'string' || !c.label.trim() || (c.outcome === 'judged' && (c.risk?.status !== 'scored' || !finite(c.risk?.score)))) throw Error('The saved demo data is invalid.');
        ids.add(c.id);
        if (!['real-non-biology','real-biology','synthetic'].includes(c.selectionGroup)) throw Error('The conversation category is missing.');
      }
      cases = dataset.cases.sort((a,b) => a.id.localeCompare(b.id)); selectedIds = new Set(cases.map(c => c.id));
      renderSelector(); showView();
    } catch (error) { fail(error.message || 'The saved demo data could not be loaded.'); }
  }
  buildFormulaPage(); load();
})();
