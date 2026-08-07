/* ===================================================================
   BUNKER BROS BONANZA — app logic (v3)
=================================================================== */

const STORAGE_KEY_PREFIX = 'bbBonanzaRoom_v1_';
const ACTIVE_ROOM_KEY = 'bbActiveRoomId_v1';
// This deployment's Supabase project. The anon key is meant to be public —
// row-level security + the create_room/join_room functions are what
// actually gate access, not secrecy of this key.
const SUPABASE_URL = 'https://nsztrhvlzmwtucunktgo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3qUoihACpekhjQLs4x1t3w_kXDV_Ti4';

/* ---------------------------------------------------------------
   HEIGHT FINDER
---------------------------------------------------------------- */
function updateHeight() {
  document.documentElement.style.setProperty(
    "--app-height",
    `${window.innerHeight}px`
  );

  const isPWA =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true; // Older iOS support

  if (isPWA) {
    document.body.classList.add("pwa");
  }

  if (isPWA) {
    document.documentElement.style.setProperty("--bottom-offset", "4px");
  }
}

window.addEventListener("resize", updateHeight);
window.addEventListener("orientationchange", updateHeight);

updateHeight();

const bar = document.querySelector(".tab-bar");

function updateBar() {
  if (!window.visualViewport) return;

  const offset =
    window.innerHeight -
    window.visualViewport.height -
    window.visualViewport.offsetTop;

  bar.style.transform = `translateY(${offset}px)`;
}

visualViewport.addEventListener("resize", updateBar);
visualViewport.addEventListener("scroll", updateBar);
updateBar();

const tabBar = document.querySelector(".tab-bar");

function updateKeyboardState() {
    if (!window.visualViewport) return;

    const keyboardOpen =
        window.visualViewport.height < window.innerHeight - 100;

    tabBar.classList.toggle("keyboard-open", keyboardOpen);
}

if (window.visualViewport) {
    visualViewport.addEventListener("resize", updateKeyboardState);
    visualViewport.addEventListener("scroll", updateKeyboardState);
}

updateKeyboardState();

/* ---------------------------------------------------------------
   DEFAULT STATE
---------------------------------------------------------------- */
function defaultHoles() {
  const pars = [4,4,3,4,4,4,4,3,5, 4,3,4,5,3,4,5,4,4];
  const idx  = [1,7,6,14,8,9,2,18,17, 11,13,3,5,10,16,4,12,15];
  return pars.map((par, i) => ({ number: i + 1, par, index: idx[i] }));
}

function defaultCourse(name, ctpHole, ldHole) {
  return { name, holes: defaultHoles(), ctpHole, ldHole };
}

function defaultConfig() {
  return {
    players: [
      { id: 'p1', name: 'Player 1' },
      { id: 'p2', name: 'Player 2' },
      { id: 'p3', name: 'Player 3' }
    ],
    courses: [
      defaultCourse('Round 1 Course', 8, 13),
      defaultCourse('Round 2 Course', 11, 9),
      defaultCourse('Round 3 Course', 3, 16)
    ],
    dailyGame: { first: 10, second: 4 },
    stableford: { bogey: 1, par: 2, birdie: 3, eagle: 4, albatross: 5 },
    sideGamePoints: 2,
    wolf: { soloWin: 2, teamWin: 1, opponentWin: 1, blindMultiplier: 2 },
    oneOneOne: { soloWin: 2, teamWin: 1 },
    bestBallGoal: 84,
    openScoring: false,
    pin: '1234',
    requirePinForEditors: true
  };
}

function emptyHoleData() { return { p1: null, p2: null, p3: null }; }

function defaultRounds() {
  const makeHoles = (extra) => {
    const holes = {};
    for (let n = 1; n <= 18; n++) holes[n] = Object.assign(emptyHoleData(), extra ? extra(n) : {});
    return holes;
  };
  return [
    { id: 1, type: 'matchplay3', label: 'Round 1', gameName: '3-Way Match Play',
      holes: makeHoles(), ctpWinner: null, ldWinner: null },
    { id: 2, type: 'wolf', label: 'Round 2', gameName: 'Wolf',
      holes: makeHoles(() => ({ wolf: { partner: 'lone' } })), ctpWinner: null, ldWinner: null,
      wolfOrder: ['p1', 'p2', 'p3'] },
    { id: 3, type: '111', label: 'Round 3', gameName: '1-1-1',
      holes: makeHoles(), ctpWinner: null, ldWinner: null }
  ];
}

function emptyRoomState() {
  return { config: defaultConfig(), rounds: defaultRounds(), archivedSeasons: [], year: String(new Date().getFullYear()), unlocked: false };
}

// Local cache of a room's data, keyed by room id, so the app has something
// to show instantly (and offline) before/between Supabase round-trips.
function loadRoomCache(roomId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + roomId);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.config && parsed.rounds) {
        if (!parsed.archivedSeasons) parsed.archivedSeasons = [];
        if (!parsed.year) parsed.year = String(new Date().getFullYear());
        if (!parsed.rounds[1].wolfOrder) parsed.rounds[1].wolfOrder = ['p1', 'p2', 'p3'];
        if (parsed.config.openScoring == null) parsed.config.openScoring = false;
        parsed.unlocked = false;
        return parsed;
      }
    }
  } catch (e) { console.warn('Could not load room cache', e); }
  return null;
}

let state = emptyRoomState();

// Auth + room-membership runtime state (not itself game data — this drives
// which room's data currently lives in `state` above).
let auth = { client: null, session: null, rooms: [], activeRoomId: null, ready: false };

function saveState() {
  if (!auth.activeRoomId) return;
  if (!isViewingLive()) {
    // Editing an archived season: write the change back into that season's
    // entry inside the live room snapshot (archived_seasons is just a JSON
    // column on the same room row), rather than treating it as live data.
    const seasons = sortedArchivedSeasons();
    const target = seasons.find(s => s.archivedAt === viewingSeasonKey);
    if (target) { target.config = state.config; target.rounds = state.rounds; }
  }
  try { localStorage.setItem(STORAGE_KEY_PREFIX + auth.activeRoomId, JSON.stringify(isViewingLive() ? state : liveRoomState)); }
  catch (e) { console.warn('Could not save room cache', e); }
  if (!cloudSync.applyingRemote) pushStateToCloud();
}

/* ---------------------------------------------------------------
   PERMISSIONS
---------------------------------------------------------------- */
function activeMembership() {
  const real = auth.rooms.find(r => r.id === auth.activeRoomId);
  if (real) return real;
  if (auth.isSuperAdmin && auth.activeRoomId && auth.activeRoomId === auth.godOverrideRoomId) {
    return { id: auth.activeRoomId, player_id: null, role: 'admin' };
  }
  return null;
}
function isGodOverrideRoom() { return !auth.rooms.some(r => r.id === auth.activeRoomId) && !!auth.godOverrideRoomId; }
function myPlayerId() { const m = activeMembership(); return m ? m.player_id : null; }
function myRole() { const m = activeMembership(); return m ? (m.role || 'editor') : null; }
function isAdmin() { return myRole() === 'admin'; }
function canEditAnyScore() {
  if (!isViewingLive() && !isAdmin()) return false;
  if (myRole() === 'viewer') return false;
  return isAdmin() || (!!auth.session && !!auth.activeRoomId);
}
function canEditPlayer(id) {
  if (!isViewingLive() && !isAdmin()) return false;
  if (myRole() === 'viewer') return false;
  return isAdmin() || !!state.config.openScoring || myPlayerId() === id;
}
function appReady() { return !!auth.session && !!auth.activeRoomId; }

let editorPinUnlocked = false;
function canEditGameSettings() {
  if (isAdmin()) return true;
  if (myRole() !== 'editor') return false;
  if (!state.config.requirePinForEditors) return true;
  return editorPinUnlocked;
}

/* ---------------------------------------------------------------
   HELPERS
---------------------------------------------------------------- */
function playerIds() { return state.config.players.map(p => p.id); }
function playerName(id) {
  const p = state.config.players.find(p => p.id === id);
  return p ? p.name : id;
}
function initial(id) { return (playerName(id)[0] || '?').toUpperCase(); }
function courseFor(roundIdx) { return state.config.courses[roundIdx - 1]; }
function holeConfig(roundIdx, n) {
  const c = courseFor(roundIdx);
  return (c.holes.find(h => h.number === n)) || { number: n, par: 4, index: n };
}

/* ---------------------------------------------------------------
   SCORING ENGINE
---------------------------------------------------------------- */
function stablefordForScore(strokes, par) {
  if (strokes == null || strokes === '') return null;
  const s = state.config.stableford;
  const diff = strokes - par;
  if (diff <= -3) return s.albatross;
  if (diff === -2) return s.eagle;
  if (diff === -1) return s.birdie;
  if (diff === 0) return s.par;
  if (diff === 1) return s.bogey;
  return 0;
}

function scoreCategoryClass(strokes, par) {
  if (strokes == null) return 'score-blank';
  const diff = strokes - par;
  if (diff <= -2) return 'score-eagle';
  if (diff === -1) return 'score-birdie';
  if (diff >= 1) return 'score-bogey';
  return '';
}

function allEntered(holeData, ids) {
  return ids.every(id => holeData[id] != null && holeData[id] !== '');
}

function matchPlayHolePoints(holeData, ids) {
  if (!allEntered(holeData, ids)) return null;
  const vals = ids.map(id => holeData[id]);
  const min = Math.min(...vals);
  const winners = ids.filter(id => holeData[id] === min);
  const result = {};
  ids.forEach(id => result[id] = 0);
  if (winners.length === 1) result[winners[0]] = 1;
  else if (winners.length === 2) winners.forEach(id => result[id] = 0.5);
  return result;
}

function rotatedPlayer(holeNumber, offset) {
  const ids = playerIds();
  return ids[(holeNumber - 1 + offset) % ids.length];
}

// Wolf tee order for a given hole, with the back nine using the reversed base order.
function getWolfOrderForHole(round, holeNumber) {
  const base = (round.wolfOrder && round.wolfOrder.length === 3) ? round.wolfOrder : playerIds();
  let order, idx;
  if (holeNumber <= 9) { order = base; idx = (holeNumber - 1) % 3; }
  else { order = [...base].reverse(); idx = (holeNumber - 10) % 3; }
  return { wolf: order[idx], first: order[(idx + 1) % 3], second: order[(idx + 2) % 3] };
}

function wolfHolePoints(holeData, holeNumber, round) {
  const ids = playerIds();
  if (!allEntered(holeData, ids)) return null;
  const cfg = state.config.wolf;
  const { wolf: wolfPlayer, first, second } = getWolfOrderForHole(round, holeNumber);
  const others = ids.filter(id => id !== wolfPlayer);
  const decision = (holeData.wolf && holeData.wolf.partner) || 'lone'; // 'lone' | 'blind' | 'first' | 'second'
  const isBlind = decision === 'blind';
  const isLoneStyle = decision === 'lone' || decision === 'blind';
  let teamIds, oppIds, partnerId = null;
  if (isLoneStyle) { teamIds = [wolfPlayer]; oppIds = others; }
  else {
    partnerId = decision === 'first' ? first : second;
    teamIds = [wolfPlayer, partnerId];
    oppIds = others.filter(id => id !== partnerId);
  }
  const teamBest = Math.min(...teamIds.map(id => holeData[id]));
  const oppBest = Math.min(...oppIds.map(id => holeData[id]));
  const mult = isBlind ? (cfg.blindMultiplier || 2) : 1;
  const result = {}; ids.forEach(id => result[id] = 0);
  let outcome = 'tie';
  if (teamBest < oppBest) {
    outcome = 'team-win';
    const base = isLoneStyle ? cfg.soloWin : cfg.teamWin;
    teamIds.forEach(id => result[id] = base * mult);
  } else if (oppBest < teamBest) {
    outcome = 'opp-win';
    oppIds.forEach(id => result[id] = cfg.opponentWin * mult);
  }
  return { points: result, wolfPlayer, teamIds, oppIds, lone: isLoneStyle, blind: isBlind, partnerId, outcome, decision };
}

function oneOneOneHolePoints(holeData, holeNumber) {
  const ids = playerIds();
  if (!allEntered(holeData, ids)) return null;
  const cfg = state.config.oneOneOne;
  const soloPlayer = rotatedPlayer(holeNumber, 0);
  const teamIds = ids.filter(id => id !== soloPlayer);
  const soloScore = holeData[soloPlayer];
  const teamBest = Math.min(...teamIds.map(id => holeData[id]));
  const result = {}; ids.forEach(id => result[id] = 0);
  let outcome = 'tie';
  if (soloScore < teamBest) { outcome = 'solo-win'; result[soloPlayer] = cfg.soloWin; }
  else if (teamBest < soloScore) { outcome = 'team-win'; teamIds.forEach(id => result[id] = cfg.teamWin); }
  return { points: result, soloPlayer, teamIds, outcome };
}

function computeDailyAwards(totals) {
  const first = state.config.dailyGame.first;
  const second = state.config.dailyGame.second;
  const positions = [first, second, 0];
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const awards = {};
  let i = 0;
  while (i < entries.length) {
    let j = i;
    while (j < entries.length && entries[j][1] === entries[i][1]) j++;
    const group = entries.slice(i, j);
    const share = positions.slice(i, j).reduce((a, b) => a + b, 0) / group.length;
    group.forEach(([id]) => awards[id] = share);
    i = j;
  }
  return awards;
}

function computeRound(round, roundIdx) {
  const ids = playerIds();
  const perHole = [];
  const rawGameTotals = {}; ids.forEach(id => rawGameTotals[id] = 0);
  const stablefordTotals = {}; ids.forEach(id => stablefordTotals[id] = 0);
  const strokeTotals = {}; ids.forEach(id => strokeTotals[id] = 0);
  let bestBallTotal = 0, bestBallHolesCounted = 0;
  let holesComplete = 0;

  for (let n = 1; n <= 18; n++) {
    const hd = round.holes[n];
    const hc = holeConfig(roundIdx, n);
    const par = hc.par;
    const stableford = {};
    ids.forEach(id => {
      const pts = stablefordForScore(hd[id], par);
      stableford[id] = pts;
      if (pts != null) stablefordTotals[id] += pts;
      if (hd[id] != null) strokeTotals[id] += hd[id];
    });

    let gamePoints = null, meta = null;
    if (round.type === 'matchplay3') {
      gamePoints = matchPlayHolePoints(hd, ids);
    } else if (round.type === 'wolf') {
      const w = wolfHolePoints(hd, n, round);
      if (w) { gamePoints = w.points; meta = w; }
    } else if (round.type === '111') {
      const o = oneOneOneHolePoints(hd, n);
      if (o) { gamePoints = o.points; meta = o; }
    }
    if (gamePoints) {
      ids.forEach(id => rawGameTotals[id] += gamePoints[id]);
      holesComplete++;
    }

    let bestBall = null;
    if (round.type === 'matchplay3' && allEntered(hd, ids)) {
      bestBall = Math.min(...ids.map(id => hd[id]));
      bestBallTotal += bestBall;
      bestBallHolesCounted++;
    }

    perHole.push({ number: n, par, index: hc.index, scores: hd, stableford, gamePoints, meta, bestBall });
  }

  const dailyAwards = holesComplete > 0 ? computeDailyAwards(rawGameTotals) : Object.fromEntries(ids.map(id => [id, 0]));
  const finalized = holesComplete === 18;

  return { perHole, rawGameTotals, stablefordTotals, strokeTotals, dailyAwards, bestBallTotal, bestBallHolesCounted, holesComplete, finalized };
}

function sumOutInTotal(perHole, keyFn) {
  let out = 0, inn = 0;
  perHole.forEach(h => {
    const v = keyFn(h);
    if (v == null) return;
    if (h.number <= 9) out += v; else inn += v;
  });
  return { out, inn, total: out + inn };
}

function computeAll() {
  const ids = playerIds();
  const rounds = state.rounds.map((r, i) => computeRound(r, i + 1));
  const totalsPerPlayer = {};
  ids.forEach(id => totalsPerPlayer[id] = { game: 0, stableford: 0, ctp: 0, drive: 0, total: 0, safeGame: 0, safeTotal: 0, perRound: [] });

  state.rounds.forEach((round, i) => {
    const rc = rounds[i];
    ids.forEach(id => {
      const game = rc.dailyAwards[id] || 0;
      const safeGame = rc.finalized ? game : 0;
      const stableford = rc.stablefordTotals[id] || 0;
      const ctp = round.ctpWinner === id ? state.config.sideGamePoints : 0;
      const drive = round.ldWinner === id ? state.config.sideGamePoints : 0;
      const roundTotal = game + stableford + ctp + drive;
      const safeRoundTotal = safeGame + stableford + ctp + drive;
      totalsPerPlayer[id].game += game;
      totalsPerPlayer[id].safeGame += safeGame;
      totalsPerPlayer[id].stableford += stableford;
      totalsPerPlayer[id].ctp += ctp;
      totalsPerPlayer[id].drive += drive;
      totalsPerPlayer[id].total += roundTotal;
      totalsPerPlayer[id].safeTotal += safeRoundTotal;
      totalsPerPlayer[id].perRound.push({ game, safeGame, stableford, ctp, drive, total: roundTotal, safeTotal: safeRoundTotal, finalized: rc.finalized });
    });
  });

  return { rounds, totalsPerPlayer };
}

/* ---------------------------------------------------------------
   STATS ENGINE
---------------------------------------------------------------- */
function computeStats(computed) {
  const ids = playerIds();
  const stats = {};
  ids.forEach(id => stats[id] = {
    birdies: 0, pars: 0, bogeys: 0, eagles: 0, albatrosses: 0,
    dailyWins: 0,
    mp3Wins: 0, mp3Ties: 0,
    wolfChosenAsTeammate: 0,
    loneWolfW: 0, loneWolfL: 0, loneWolfT: 0,
    teammateW: 0, teammateL: 0, teammateT: 0,
    oneOneOneSoloWins: 0, oneOneOneTeamWins: 0,
    bestRoundScore: null, bestRoundLabel: '',
    mostStablefordInRound: null, mostStablefordLabel: ''
  });

  state.rounds.forEach((round, ri) => {
    const rc = computed.rounds[ri];

    ids.forEach(id => {
      const st = rc.strokeTotals[id];
      if (st > 0 && (stats[id].bestRoundScore == null || st < stats[id].bestRoundScore)) {
        stats[id].bestRoundScore = st; stats[id].bestRoundLabel = round.label;
      }
      const sf = rc.stablefordTotals[id];
      if (stats[id].mostStablefordInRound == null || sf > stats[id].mostStablefordInRound) {
        stats[id].mostStablefordInRound = sf; stats[id].mostStablefordLabel = round.label;
      }
    });

    rc.perHole.forEach(h => {
      ids.forEach(id => {
        const par = h.par, sc = h.scores[id];
        if (sc == null) return;
        const diff = sc - par;
        if (diff === -1) stats[id].birdies++;
        else if (diff === 0) stats[id].pars++;
        else if (diff === 1) stats[id].bogeys++;
        else if (diff === -2) stats[id].eagles++;
        else if (diff <= -3) stats[id].albatrosses++;
      });

      if (round.type === 'matchplay3' && h.gamePoints) {
        ids.forEach(id => {
          if (h.gamePoints[id] === 1) stats[id].mp3Wins++;
          else if (h.gamePoints[id] === 0.5) stats[id].mp3Ties++;
        });
      }

      if (round.type === 'wolf' && h.meta) {
        const m = h.meta;
        if (!m.lone) {
          const teammate = m.teamIds.find(id => id !== m.wolfPlayer);
          if (teammate) stats[teammate].wolfChosenAsTeammate++;
        }
        ids.forEach(id => {
          if (id === m.wolfPlayer && m.lone) {
            if (m.outcome === 'team-win') stats[id].loneWolfW++;
            else if (m.outcome === 'opp-win') stats[id].loneWolfL++;
            else stats[id].loneWolfT++;
          } else if (!m.lone && m.teamIds.includes(id) && id !== m.wolfPlayer) {
            if (m.outcome === 'team-win') stats[id].teammateW++;
            else if (m.outcome === 'opp-win') stats[id].teammateL++;
            else stats[id].teammateT++;
          }
        });
      }

      if (round.type === '111' && h.meta) {
        const m = h.meta;
        if (m.outcome === 'solo-win') stats[m.soloPlayer].oneOneOneSoloWins++;
        else if (m.outcome === 'team-win') m.teamIds.forEach(id => stats[id].oneOneOneTeamWins++);
      }
    });
  });

  state.rounds.forEach((round, ri) => {
    const rc = computed.rounds[ri];
    const maxAward = Math.max(...ids.map(id => rc.dailyAwards[id] || 0));
    if (maxAward > 0) ids.forEach(id => { if ((rc.dailyAwards[id] || 0) === maxAward) stats[id].dailyWins++; });
  });

  return stats;
}

/* ---------------------------------------------------------------
   RENDERING — HEADER
---------------------------------------------------------------- */
function renderHeader() {
  const names = state.config.players.map(p => p.name).join(' · ');
  document.getElementById('courseSubHeader').textContent = `Bunker Bros Bonanza · ${names}`;
}

/* ---------------------------------------------------------------
   RENDERING — HOME STATUS WIDGET
---------------------------------------------------------------- */
function renderRoundStatus() {
  if (!appReady()) { document.getElementById('roundStatusWidget').innerHTML = ''; return; }
  const computed = computeAll();
  let currentIdx = computed.rounds.findIndex(rc => !rc.finalized);
  if (currentIdx === -1) currentIdx = state.rounds.length - 1; // all done — show the last round

  const round = state.rounds[currentIdx];
  const rc = computed.rounds[currentIdx];
  const course = courseFor(currentIdx + 1);
  const isDone = rc.finalized;
  const pct = Math.round((rc.holesComplete / 18) * 100);

  const html = `<div class="status-widget">
    <div class="status-row ${isDone ? '' : 'active-round'} ${isDone ? 'done' : ''}">
      <div class="status-name">${round.label}<span class="status-course">${escapeHtml(course.name)}</span></div>
      <div class="status-track"><div class="status-fill" style="width:${pct}%"></div></div>
      <div class="status-frac">${isDone ? '<span class="status-check">✓</span> Done' : `${rc.holesComplete}/18`}</div>
    </div>
  </div>`;
  document.getElementById('roundStatusWidget').innerHTML = html;
}

function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ---------------------------------------------------------------
   RENDERING — LEADERBOARD
---------------------------------------------------------------- */
const flagSvg = `<svg class="leader-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 21V4"/><path d="M5 4l13 3.5L5 11"/></svg>`;
const chevronSvg = `<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 9l6 6 6-6"/></svg>`;

let openLeaderId = null;

function fmtNum(n) {
  if (n == null) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function fmtOrBlank(n) {
  if (n == null || n === 0) return '';
  return fmtNum(n);
}

function renderLeaderboard() {
  if (!appReady()) {
    document.getElementById('leaderboardList').innerHTML = readyGateHtml();
    document.getElementById('seasonHistoryWidget').innerHTML = '';
    return;
  }
  const computed = computeAll();
  const ids = playerIds();
  const ranked = ids.map(id => ({ id, ...computed.totalsPerPlayer[id] })).sort((a, b) => b.safeTotal - a.safeTotal);

  const container = document.getElementById('leaderboardList');
  container.innerHTML = '';

  ranked.forEach((p, i) => {
    const rank = i + 1;
    const isOpen = openLeaderId === p.id;
    const wrap = document.createElement('div');
    wrap.className = 'leader-wrap' + (isOpen ? ' open' : '');
    const showProjected = p.safeTotal !== p.total;

    const roundRows = state.rounds.map((r, ri) => {
      const pr = p.perRound[ri];
      return `<tr>
        <td>${r.label}${pr.finalized ? '' : ' *'}</td>
        <td class="num">${fmtNum(pr.safeGame)}</td>
        <td class="num">${fmtNum(pr.stableford)}</td>
        <td class="num">${fmtNum(pr.ctp)}</td>
        <td class="num">${fmtNum(pr.drive)}</td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `
      <div class="leader-card rank-${rank} ${isOpen ? 'open' : ''}" data-player="${p.id}">
        <div class="leader-rank">${rank}</div>
        ${rank === 1 ? flagSvg : '<div style="width:20px"></div>'}
        <div class="leader-info">
          <div class="leader-name">${playerName(p.id)}</div>
          <div class="leader-sub">${rank === 1 ? 'Leading the Bonanza' : `${(ranked[0].safeTotal - p.safeTotal).toFixed(1)} back`}</div>
        </div>
        <div class="leader-points">${fmtNum(p.safeTotal)}${showProjected ? `<span class="projected">(${fmtNum(p.total)})</span>` : ''}<span class="unit">pts</span></div>
        ${chevronSvg}
      </div>
      <div class="leader-detail">
        <div class="leader-detail-inner">
          <table class="breakdown-table">
            <thead><tr><th>Round</th><th>Game</th><th>Stableford</th><th>CTP</th><th>Drive</th></tr></thead>
            <tbody>${roundRows}</tbody>
            <tfoot><tr><td>Totals</td><td class="num">${fmtNum(p.safeGame)}</td><td class="num">${fmtNum(p.stableford)}</td><td class="num">${fmtNum(p.ctp)}</td><td class="num">${fmtNum(p.drive)}</td></tr></tfoot>
          </table>
          ${showProjected ? `<p class="helper-text" style="margin-top:8px;">* Round still in progress — game points not yet locked in. Number in parentheses is the live projection.</p>` : ''}
        </div>
      </div>
    `;
    container.appendChild(wrap);
  });

  container.querySelectorAll('.leader-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-player');
      openLeaderId = openLeaderId === id ? null : id;
      renderLeaderboard();
    });
  });
}

/* ---------------------------------------------------------------
   RENDERING — SCORECARD (row-assembly helper: Out after hole 9)
---------------------------------------------------------------- */
let activeRoundTab = 1;
let collapsedPlayers = {};

function assembleRow(labelHtml, cells18, outHtml, inHtml, totalHtml, rowClass, extraAttrs) {
  let html = `<tr class="${rowClass || ''}" ${extraAttrs || ''}>${labelHtml}`;
  for (let i = 0; i < 9; i++) html += cells18[i];
  html += outHtml;
  for (let i = 9; i < 18; i++) html += cells18[i];
  html += inHtml + totalHtml;
  html += '</tr>';
  return html;
}

function holeColClasses(course, n) {
  const cls = [];
  if (n === course.ctpHole) cls.push('ctp-col');
  if (n === course.ldHole) cls.push('ld-col');
  if (n > 9) cls.push('back9'); else cls.push('front9');
  return cls.join(' ');
}

function wolfCompactCell(round, n) {
  const decision = (round.holes[n].wolf && round.holes[n].wolf.partner) || 'lone';
  const { wolf, first, second } = getWolfOrderForHole(round, n);
  const wIn = initial(wolf);
  if (decision === 'blind') return `<span class="indicator-blind">${wIn}⚡</span>`;
  if (decision === 'lone') return wIn;
  const partnerId = decision === 'first' ? first : second;
  return `${wIn}+${initial(partnerId)}`;
}

function renderRoundsView() {
  if (!appReady()) { document.getElementById('roundContent').innerHTML = readyGateHtml(); return; }
  document.querySelectorAll('#roundSegmented button').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.round) === activeRoundTab);
  });
  const computed = computeAll();
  const round = state.rounds[activeRoundTab - 1];
  const rc = computed.rounds[activeRoundTab - 1];
  const ids = playerIds();
  const course = courseFor(activeRoundTab);
  const editable = canEditAnyScore();

  const holesArr = []; for (let n = 1; n <= 18; n++) holesArr.push(n);

  let html = `<div class="scorecard-scroll"><table class="scorecard"><thead>`;

  // course / game title row
  html += `<tr class="card-title-row"><td colspan="11" class="title-left">${escapeHtml(course.name)}</td><td colspan="11" class="title-right">${round.gameName}</td></tr>`;

  // hole numbers header row
  const headerCells = holesArr.map(n => `<th class="${holeColClasses(course, n)}">${n}</th>`);
  html += assembleRow('<th>Hole</th>', headerCells, '<th class="out-col">Out</th>', '<th class="in-col">In</th>', '<th class="total-col">Total</th>', 'hole-header');
  html += `</thead><tbody>`;

  // Par row
  let parOut = 0, parIn = 0;
  const parCells = holesArr.map(n => { const par = holeConfig(activeRoundTab, n).par; if (n <= 9) parOut += par; else parIn += par; return `<td class="${holeColClasses(course, n)}">${par}</td>`; });
  html += assembleRow('<td>Par</td>', parCells, `<td class="out-col">${parOut}</td>`, `<td class="in-col">${parIn}</td>`, `<td class="total-col">${parOut + parIn}</td>`, 'par-row');

  // Index row
  const idxCells = holesArr.map(n => `<td class="${holeColClasses(course, n)}">${holeConfig(activeRoundTab, n).index}</td>`);
  html += assembleRow('<td>Index</td>', idxCells, '<td class="out-col"></td>', '<td class="in-col"></td>', '<td class="total-col"></td>', 'index-row');

  // Player rows
  ids.forEach(id => {
    const collapsed = !!collapsedPlayers[id];
    let strokeOut = 0, strokeIn = 0;
    const scoreCells = rc.perHole.map(h => {
      const v = h.scores[id];
      if (v != null) { if (h.number <= 9) strokeOut += v; else strokeIn += v; }
      const cls = scoreCategoryClass(v, h.par);
      return `<td class="score-cell ${cls} ${holeColClasses(course, h.number)}">${v != null ? v : '–'}</td>`;
    });
    html += assembleRow(
      `<td>${playerName(id)} <span class="toggle-caret">▾</span></td>`,
      scoreCells,
      `<td class="out-col">${strokeOut || ''}</td>`, `<td class="in-col">${strokeIn || ''}</td>`, `<td class="total-col">${(strokeOut + strokeIn) || ''}</td>`,
      `score-row player-toggle-row ${collapsed ? 'collapsed' : ''}`,
      `data-toggle="${id}"`
    );

    const gpOutIn = sumOutInTotal(rc.perHole, h => h.gamePoints ? h.gamePoints[id] : null);
    const gpCells = rc.perHole.map(h => { const v = h.gamePoints ? h.gamePoints[id] : null; return `<td class="${holeColClasses(course, h.number)}">${fmtOrBlank(v)}</td>`; });
    html += assembleRow('<td>Game Points</td>', gpCells,
      `<td class="out-col">${fmtOrBlank(gpOutIn.out)}</td>`, `<td class="in-col">${fmtOrBlank(gpOutIn.inn)}</td>`, `<td class="total-col">${fmtOrBlank(gpOutIn.total)}</td>`,
      `subrow ${collapsed ? 'hidden-row' : ''}`);

    const sfOutIn = sumOutInTotal(rc.perHole, h => h.stableford[id]);
    const sfCells = rc.perHole.map(h => { const v = h.stableford[id]; return `<td class="${holeColClasses(course, h.number)}">${fmtOrBlank(v)}</td>`; });
    html += assembleRow('<td>Stableford Points</td>', sfCells,
      `<td class="out-col">${fmtOrBlank(sfOutIn.out)}</td>`, `<td class="in-col">${fmtOrBlank(sfOutIn.inn)}</td>`, `<td class="total-col">${fmtOrBlank(sfOutIn.total)}</td>`,
      `subrow ${collapsed ? 'hidden-row' : ''}`);
  });

  // Best Ball row (round 1 only)
  if (round.type === 'matchplay3') {
    const bbOutIn = sumOutInTotal(rc.perHole, h => h.bestBall);
    const bbCells = rc.perHole.map(h => `<td class="${holeColClasses(course, h.number)}">${h.bestBall != null ? h.bestBall : ''}</td>`);
    html += assembleRow(`<td>Best Ball (goal ${state.config.bestBallGoal})</td>`, bbCells,
      `<td class="out-col">${bbOutIn.out || ''}</td>`, `<td class="in-col">${bbOutIn.inn || ''}</td>`, `<td class="total-col">${bbOutIn.total || ''}</td>`,
      'bestball-row');
  }

  // Wolf indicator row (round 2, read-only — edit happens in Enter Score)
  if (round.type === 'wolf') {
    const wCells = rc.perHole.map(h => `<td class="${holeColClasses(course, h.number)}">${wolfCompactCell(round, h.number)}</td>`);
    html += assembleRow('<td>🐺 Wolf</td>', wCells, '<td class="out-col"></td>', '<td class="in-col"></td>', '<td class="total-col"></td>', 'indicator-row');
  }

  // 1-1-1 matchup indicator row (read-only)
  if (round.type === '111') {
    const mCells = rc.perHole.map(h => `<td class="${holeColClasses(course, h.number)}">${initial(rotatedPlayer(h.number, 0))}</td>`);
    html += assembleRow('<td>Solo</td>', mCells, '<td class="out-col"></td>', '<td class="in-col"></td>', '<td class="total-col"></td>', 'indicator-row');
  }

  html += `</tbody></table></div>`;

  const ctpOpts = `<option value="">— Select —</option>` + ids.map(id => `<option value="${id}" ${round.ctpWinner === id ? 'selected' : ''}>${playerName(id)}</option>`).join('');
  const ldOpts = `<option value="">— Select —</option>` + ids.map(id => `<option value="${id}" ${round.ldWinner === id ? 'selected' : ''}>${playerName(id)}</option>`).join('');
  html += `<div class="card ctpld-row">
    <div class="field-row">
      <div class="field"><label>Closest to the Pin Winner (Hole ${course.ctpHole})</label><select id="ctpWinnerSelect" ${editable ? '' : 'disabled'}>${ctpOpts}</select></div>
      <div class="field"><label>Longest Drive Winner (Hole ${course.ldHole})</label><select id="ldWinnerSelect" ${editable ? '' : 'disabled'}>${ldOpts}</select></div>
    </div>
    ${editable ? '' : '<p class="helper-text">Log in from Settings to set the CTP/Drive winners.</p>'}
  </div>`;

  document.getElementById('roundContent').innerHTML = html;

  document.querySelectorAll('.player-toggle-row').forEach(row => {
    row.querySelector('td:first-child').addEventListener('click', () => {
      const id = row.getAttribute('data-toggle');
      if (id) { collapsedPlayers[id] = !collapsedPlayers[id]; renderRoundsView(); }
    });
  });
  const ctpSel = document.getElementById('ctpWinnerSelect');
  const ldSel = document.getElementById('ldWinnerSelect');
  if (ctpSel) ctpSel.addEventListener('change', () => { round.ctpWinner = ctpSel.value || null; saveState(); renderLeaderboard(); });
  if (ldSel) ldSel.addEventListener('change', () => { round.ldWinner = ldSel.value || null; saveState(); renderLeaderboard(); });
}

/* ---------------------------------------------------------------
   RENDERING — STATS (grouped by player, logged-in player first)
---------------------------------------------------------------- */
function readyGateHtml() {
  return `<div class="empty-state">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
    <p>Sign in and join or create a room to see this.</p>
  </div>`;
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function downloadCSV(filename, text) {
  try {
    const blob = new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  } catch (e) { console.warn(e); showToast('Export failed'); }
}

function gameNoteForHole(round, h) {
  if (round.type === 'wolf' && h.meta) {
    const m = h.meta;
    if (m.lone) return `${playerName(m.wolfPlayer)}${m.blind ? ' blind' : ' lone'}`;
    return `${playerName(m.wolfPlayer)}+${playerName(m.partnerId)}`;
  }
  if (round.type === '111' && h.meta) return `${playerName(h.meta.soloPlayer)} solo`;
  return '';
}

function csvRowsForSnapshot(yearLabel, config, rounds) {
  const savedConfig = state.config, savedRounds = state.rounds;
  state.config = config; state.rounds = rounds;
  const computed = computeAll();
  const ids = playerIds();
  const rows = [];
  state.rounds.forEach((round, ri) => {
    const rc = computed.rounds[ri];
    const course = courseFor(ri + 1);
    const ctpWinner = round.ctpWinner ? playerName(round.ctpWinner) : '';
    const ldWinner = round.ldWinner ? playerName(round.ldWinner) : '';
    rc.perHole.forEach(h => {
      const note = gameNoteForHole(round, h);
      ids.forEach(id => {
        rows.push([
          yearLabel, round.label, course.name, round.gameName, h.number, h.par, h.index,
          playerName(id), h.scores[id] != null ? h.scores[id] : '',
          h.gamePoints ? (h.gamePoints[id] != null ? h.gamePoints[id] : '') : '',
          h.stableford[id] != null ? h.stableford[id] : '',
          note, ctpWinner, ldWinner
        ]);
      });
    });
  });
  state.config = savedConfig; state.rounds = savedRounds;
  return rows;
}

function exportRoomCSV() {
  const header = ['Year', 'Round', 'Course', 'Game', 'Hole', 'Par', 'Index', 'Player', 'Strokes', 'GamePoints', 'StablefordPoints', 'GameNote', 'CTPWinner', 'DriveWinner'];
  const liveSrc = liveRoomState || state;
  let rows = [header];
  rows = rows.concat(csvRowsForSnapshot(liveSrc.year, liveSrc.config, liveSrc.rounds));
  sortedArchivedSeasons().forEach(s => { rows = rows.concat(csvRowsForSnapshot(s.year, s.config, s.rounds)); });
  const csvText = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const room = auth.rooms.find(r => r.id === auth.activeRoomId);
  downloadCSV(`${(room ? room.room_code : 'bunker-bros')}-export.csv`, csvText);
  showToast('Exported');
}

function computeStatsForSnapshot(snapshot) {
  const savedConfig = state.config, savedRounds = state.rounds;
  state.config = snapshot.config; state.rounds = snapshot.rounds;
  const computed = computeAll();
  const stats = computeStats(computed);
  state.config = savedConfig; state.rounds = savedRounds;
  return stats;
}

const LIFETIME_SUM_KEYS = ['birdies', 'pars', 'bogeys', 'eagles', 'albatrosses', 'dailyWins', 'mp3Wins', 'mp3Ties',
  'wolfChosenAsTeammate', 'loneWolfW', 'loneWolfL', 'loneWolfT', 'teammateW', 'teammateL', 'teammateT',
  'oneOneOneSoloWins', 'oneOneOneTeamWins'];

function computeLifetimeStats() {
  const liveSrc = liveRoomState || state;
  const snapshots = [{ config: liveSrc.config, rounds: liveSrc.rounds, label: liveSrc.year }];
  (liveSrc.archivedSeasons || []).forEach(s => snapshots.push({ config: s.config, rounds: s.rounds, label: s.year }));
  const ids = playerIds();
  const merged = {};
  ids.forEach(id => merged[id] = Object.assign(
    Object.fromEntries(LIFETIME_SUM_KEYS.map(k => [k, 0])),
    { bestRoundScore: null, bestRoundLabel: '', mostStablefordInRound: null, mostStablefordLabel: '' }
  ));
  snapshots.forEach(snap => {
    const s = computeStatsForSnapshot(snap);
    ids.forEach(id => {
      const a = merged[id], b = s[id];
      if (!b) return;
      LIFETIME_SUM_KEYS.forEach(k => a[k] += b[k]);
      if (b.bestRoundScore != null && (a.bestRoundScore == null || b.bestRoundScore < a.bestRoundScore)) {
        a.bestRoundScore = b.bestRoundScore; a.bestRoundLabel = `${snap.label} · ${b.bestRoundLabel}`;
      }
      if (b.mostStablefordInRound != null && (a.mostStablefordInRound == null || b.mostStablefordInRound > a.mostStablefordInRound)) {
        a.mostStablefordInRound = b.mostStablefordInRound; a.mostStablefordLabel = `${snap.label} · ${b.mostStablefordLabel}`;
      }
    });
  });
  return merged;
}

let statsMode = 'lifetime';

function renderStats() {
  if (!appReady()) { document.getElementById('statsList').innerHTML = readyGateHtml(); return; }
  const stats = statsMode === 'lifetime' ? computeLifetimeStats() : computeStats(computeAll());
  let ids = playerIds();
  const loggedInId = myPlayerId();
  if (loggedInId && ids.includes(loggedInId)) {
    ids = [loggedInId, ...ids.filter(id => id !== loggedInId)];
  }
  const list = document.getElementById('statsList');

  let html = `<div class="segmented" id="statsModeSegmented">
    <button data-mode="lifetime" class="${statsMode === 'lifetime' ? 'active' : ''}">Lifetime</button>
    <button data-mode="weekend" class="${statsMode === 'weekend' ? 'active' : ''}">This Weekend</button>
  </div>`;
  ids.forEach(id => {
    const s = stats[id];
    const isYou = id === loggedInId;
    html += `<div class="player-stat-card ${isYou ? 'you-card' : ''}"><h3>${playerName(id)}${isYou ? '<span class="you-badge">You</span>' : ''}</h3>`;

    html += statGroup('Scoring', [
      ['Eagles+', s.eagles + s.albatrosses], ['Birdies', s.birdies], ['Pars', s.pars], ['Bogeys', s.bogeys]
    ]);
    html += statGroup('Daily Games', [
      ['Daily game wins', s.dailyWins]
    ]);
    html += statGroup('3-Way Match Play', [
      ['Holes won', s.mp3Wins], ['Holes tied', s.mp3Ties]
    ]);
    html += statGroup('Wolf', [
      ['Chosen as teammate', s.wolfChosenAsTeammate],
      ['Lone/Blind wolf W-L-T', `${s.loneWolfW}-${s.loneWolfL}-${s.loneWolfT}`],
      ["As wolf's teammate W-L-T", `${s.teammateW}-${s.teammateL}-${s.teammateT}`]
    ]);
    html += statGroup('1-1-1', [
      ['Holes won solo', s.oneOneOneSoloWins], ['Holes won w/ teammate', s.oneOneOneTeamWins]
    ]);
    html += statGroup('Bests', [
      ['Best round score', s.bestRoundScore != null ? `${s.bestRoundScore} (${s.bestRoundLabel})` : '–'],
      ['Most Stableford in a round', s.mostStablefordInRound != null ? `${s.mostStablefordInRound} (${s.mostStablefordLabel})` : '–']
    ]);

    html += `</div>`;
  });

  list.innerHTML = html;
  document.getElementById('statsModeSegmented').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    statsMode = b.dataset.mode;
    renderStats();
  }));
}

function statGroup(title, rows) {
  let html = `<div class="player-stat-group"><h4>${title}</h4>`;
  rows.forEach(([label, val]) => { html += `<div class="stat-line"><span>${label}</span><b>${val}</b></div>`; });
  html += `</div>`;
  return html;
}

/* ---------------------------------------------------------------
   AUTH + ROOMS (Supabase)
---------------------------------------------------------------- */
let cloudSync = { channel: null, applyingRemote: false, pushTimer: null };

let pendingRecovery = false;

async function initSupabaseAuth() {
  if (typeof supabase === 'undefined') {
    auth.ready = true; auth.sdkFailed = true;
    renderAccountSection();
    applyReadyGate();
    return;
  }
  auth.client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data } = await auth.client.auth.getSession();
  auth.session = data.session || null;
  auth.client.auth.onAuthStateChange((event, session) => {
    auth.session = session;
    if (event === 'PASSWORD_RECOVERY') { pendingRecovery = true; renderAccountSection(); }
  });
  if (auth.session) await afterLogin();
  auth.ready = true;
  renderAccountSection();
  applyReadyGate();
}

async function afterLogin() {
  const { data: profile } = await auth.client.from('profiles').select('username, is_super_admin').eq('id', auth.session.user.id).maybeSingle();
  auth.username = profile ? profile.username : (auth.session.user.email || '').split('@')[0];
  auth.isSuperAdmin = !!(profile && profile.is_super_admin);
  await loadMyRooms();
  const savedRoomId = localStorage.getItem(ACTIVE_ROOM_KEY);
  if (savedRoomId && auth.rooms.some(r => r.id === savedRoomId)) {
    await selectRoom(savedRoomId);
  } else if (auth.rooms.length === 1) {
    await selectRoom(auth.rooms[0].id);
  }
}

async function loadMyRooms() {
  const { data: memberships, error } = await auth.client.from('room_memberships').select('room_id, player_id, role');
  if (error) { console.warn(error); auth.rooms = []; return; }
  if (!memberships || !memberships.length) { auth.rooms = []; return; }
  const uniqueRoomIds = [...new Set(memberships.map(m => m.room_id))];
  const { data: rooms, error: roomErr } = await auth.client.from('rooms').select('id, room_code, name').in('id', uniqueRoomIds);
  if (roomErr) { console.warn(roomErr); auth.rooms = []; return; }
  // Dedupe defensively by room id, in case of any stray duplicate membership rows.
  const seen = new Set();
  auth.rooms = [];
  memberships.forEach(m => {
    if (seen.has(m.room_id)) return;
    seen.add(m.room_id);
    const r = (rooms || []).find(r => r.id === m.room_id) || {};
    auth.rooms.push({ id: m.room_id, room_code: r.room_code, name: r.name, player_id: m.player_id, role: m.role || 'editor' });
  });
}

async function signUp(username, email, password) {
  if (!username || !email || !password) { showToast('Fill in username, email, and password'); return; }
  const { data, error } = await auth.client.auth.signUp({ email: email.trim(), password });
  if (error) { showToast(/already registered/i.test(error.message) ? 'That email is already in use' : error.message); return; }
  auth.session = data.session || null;
  if (!auth.session) { showToast('Account created — try logging in'); renderAccountSection(); return; }
  const { error: profileErr } = await auth.client.from('profiles').insert({ id: auth.session.user.id, username: username.trim(), email: email.trim() });
  if (profileErr) { showToast(/duplicate|unique/i.test(profileErr.message) ? 'That username is taken' : 'Could not finish setting up your account'); return; }
  await afterLogin();
  renderAccountSection();
  applyReadyGate();
  showToast('Welcome, ' + username + '!');
}

async function resolveEmail(usernameOrEmail) {
  const v = usernameOrEmail.trim();
  if (v.includes('@')) return v;
  const { data: email, error } = await auth.client.rpc('get_email_for_username', { p_username: v });
  if (error || !email) return null;
  return email;
}

async function logIn(usernameOrEmail, password) {
  if (!usernameOrEmail || !password) { showToast('Enter your username/email and password'); return; }
  const email = await resolveEmail(usernameOrEmail);
  if (!email) { showToast('Incorrect username/email or password'); return; }
  const { data, error } = await auth.client.auth.signInWithPassword({ email, password });
  if (error) { showToast('Incorrect username/email or password'); return; }
  auth.session = data.session;
  await afterLogin();
  renderAccountSection();
  applyReadyGate();
}

async function requestPasswordReset(usernameOrEmail) {
  if (!usernameOrEmail) { showToast('Enter your username or email first'); return; }
  const email = await resolveEmail(usernameOrEmail);
  if (!email) { showToast('No account found'); return; }
  const { error: resetErr } = await auth.client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
  if (resetErr) { showToast('Could not send reset email'); return; }
  showToast('Check your email for a reset link');
}

async function submitNewPassword(newPassword) {
  if (!newPassword || newPassword.length < 6) { showToast('Password must be at least 6 characters'); return; }
  const { error } = await auth.client.auth.updateUser({ password: newPassword });
  if (error) { showToast('Could not update password'); return; }
  pendingRecovery = false;
  showToast('Password updated — you are signed in');
  await afterLogin();
  renderAccountSection();
  applyReadyGate();
}

async function changeUsername(newUsername) {
  newUsername = (newUsername || '').trim();
  if (!newUsername) { showToast('Enter a new username'); return; }
  const { error } = await auth.client.from('profiles').update({ username: newUsername }).eq('id', auth.session.user.id);
  if (error) { showToast(/duplicate|unique/i.test(error.message) ? 'That username is taken' : 'Could not update username'); return; }
  auth.username = newUsername;
  showToast('Username updated');
  renderAccountSection();
}

async function changePassword(newPassword) {
  if (!newPassword || newPassword.length < 6) { showToast('Password must be at least 6 characters'); return; }
  const { error } = await auth.client.auth.updateUser({ password: newPassword });
  if (error) { showToast('Could not update password'); return; }
  showToast('Password updated');
}

async function logOut() {
  if (cloudSync.channel) { auth.client.removeChannel(cloudSync.channel); cloudSync.channel = null; }
  editorPinUnlocked = false;
  liveRoomState = null; viewingSeasonKey = null;
  await auth.client.auth.signOut();
  auth.session = null; auth.rooms = []; auth.activeRoomId = null;
  auth.godOverrideRoomId = null; auth.godOverrideRoomMeta = null;
  localStorage.removeItem(ACTIVE_ROOM_KEY);
  state = emptyRoomState();
  renderAccountSection();
  applyReadyGate();
}

async function deleteMyAccount() {
  const { error } = await auth.client.rpc('delete_my_account');
  if (error) { showToast('Could not delete account'); return; }
  await logOut();
  showToast('Account deleted');
}

const ROOM_CAP = 5;
let roomActionInFlight = false;

async function createRoom(name, password) {
  if (roomActionInFlight) return;
  if (!name || !password) { showToast('Enter a room name and password'); return; }
  if (auth.rooms.length >= ROOM_CAP) { showToast(`You already have ${ROOM_CAP} rooms — leave one first`); return; }
  roomActionInFlight = true;
  const createBtn = document.getElementById('createRoomBtn');
  if (createBtn) createBtn.disabled = true;
  try {
    const { data, error } = await auth.client.rpc('create_room', { p_name: name, p_password: password });
    if (error) { showToast(/ROOM_LIMIT/.test(error.message) ? `You already have ${ROOM_CAP} rooms` : 'Could not create room'); return; }
    const row = Array.isArray(data) ? data[0] : data;
    const fresh = emptyRoomState();
    await auth.client.from('rooms').update({
      config: fresh.config, rounds: fresh.rounds, archived_seasons: fresh.archivedSeasons, year: fresh.year, updated_at: new Date().toISOString()
    }).eq('id', row.id);
    await loadMyRooms();
    await selectRoom(row.id);
    showToast('Room "' + name + '" created — share the room code & password to invite the others');
  } finally {
    roomActionInFlight = false;
    if (createBtn) createBtn.disabled = false;
  }
}

async function joinRoom(roomCode, password) {
  if (roomActionInFlight) return;
  if (!roomCode || !password) { showToast('Enter the room code and password'); return; }
  roomActionInFlight = true;
  const joinBtn = document.getElementById('joinRoomBtn');
  if (joinBtn) joinBtn.disabled = true;
  try {
    const { data, error } = await auth.client.rpc('join_room', { p_room_code: roomCode.trim(), p_password: password });
    if (error) {
      if (/ROOM_NOT_FOUND/.test(error.message)) showToast('No room with that code');
      else if (/WRONG_PASSWORD/.test(error.message)) showToast('Wrong room password');
      else if (/ROOM_LIMIT/.test(error.message)) showToast(`You already have ${ROOM_CAP} rooms`);
      else showToast('Could not join room');
      return;
    }
    await loadMyRooms();
    await selectRoom(data);
    showToast('Joined the room!');
  } finally {
    roomActionInFlight = false;
    if (joinBtn) joinBtn.disabled = false;
  }
}

async function leaveRoom(roomId, wasActive) {
  const { error } = await auth.client.rpc('leave_room', { p_room_id: roomId });
  if (error) {
    showToast(/LAST_ADMIN/.test(error.message) ? "You're the only admin — promote someone else first, or delete the room" : 'Could not leave room');
    return;
  }
  if (wasActive) { auth.activeRoomId = null; localStorage.removeItem(ACTIVE_ROOM_KEY); state = emptyRoomState(); if (cloudSync.channel) { auth.client.removeChannel(cloudSync.channel); cloudSync.channel = null; } }
  await loadMyRooms();
  renderAccountSection();
  applyReadyGate();
  showToast('Left the room');
}

async function enterRoomAsGod(roomId, name, roomCode) {
  auth.godOverrideRoomId = roomId;
  auth.godOverrideRoomMeta = { id: roomId, name, room_code: roomCode };
  await selectRoom(roomId);
}

async function selectRoom(roomId) {
  if (cloudSync.channel) { auth.client.removeChannel(cloudSync.channel); cloudSync.channel = null; }
  editorPinUnlocked = false;
  liveRoomState = null; viewingSeasonKey = null;
  auth.activeRoomId = roomId;
  localStorage.setItem(ACTIVE_ROOM_KEY, roomId);

  const cached = loadRoomCache(roomId);
  if (cached) state = cached;

  const { data: row, error } = await auth.client.from('rooms').select('config, rounds, archived_seasons, year').eq('id', roomId).maybeSingle();
  if (!error && row) applyRemoteRoomRow(row);

  cloudSync.channel = auth.client
    .channel('room-' + roomId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
      (payload) => { if (payload.new) applyRemoteRoomRow(payload.new); })
    .subscribe();

  renderAll();
  applyReadyGate();
  await ensurePlayerAssigned();
}

function switchRoomView() {
  if (cloudSync.channel && auth.client) { auth.client.removeChannel(cloudSync.channel); cloudSync.channel = null; }
  editorPinUnlocked = false;
  liveRoomState = null; viewingSeasonKey = null;
  auth.godOverrideRoomId = null; auth.godOverrideRoomMeta = null;
  auth.activeRoomId = null;
  localStorage.removeItem(ACTIVE_ROOM_KEY);
  state = emptyRoomState();
  renderAccountSection();
  applyReadyGate();
}

function applyRemoteRoomRow(row) {
  cloudSync.applyingRemote = true;
  const target = isViewingLive() ? state : liveRoomState;
  if (target) {
    target.config = row.config;
    target.rounds = row.rounds;
    target.archivedSeasons = row.archived_seasons || [];
    target.year = row.year || String(new Date().getFullYear());
    if (target.config.openScoring == null) target.config.openScoring = false;
  }
  try { localStorage.setItem(STORAGE_KEY_PREFIX + auth.activeRoomId, JSON.stringify(isViewingLive() ? state : liveRoomState)); } catch (e) {}
  renderAll();
  cloudSync.applyingRemote = false;
  setSyncDot('connected');
}

function pushStateToCloud() {
  if (!auth.activeRoomId || !auth.client) return;
  clearTimeout(cloudSync.pushTimer);
  cloudSync.pushTimer = setTimeout(() => {
    const src = isViewingLive() ? state : liveRoomState;
    if (!src) return;
    auth.client.from('rooms').update({
      config: src.config, rounds: src.rounds, archived_seasons: src.archivedSeasons, year: src.year, updated_at: new Date().toISOString()
    }).eq('id', auth.activeRoomId).then(({ error }) => { if (error) { console.warn('push failed', error); setSyncDot('error'); } });
  }, 400);
}

async function setMyPlayer(playerId) {
  const m = activeMembership();
  if (!m) return;
  const { error } = await auth.client.rpc('set_my_player', { p_room_id: auth.activeRoomId, p_player_id: playerId });
  if (error) {
    showToast(/PLAYER_TAKEN/.test(error.message) ? 'Someone already claimed that Bro' : 'Could not save — try again');
    await loadMyRooms(); renderAccountSection();
    return;
  }
  await loadMyRooms(); // role may have auto-changed (e.g. to viewer if Unassigned)
  renderAccountSection();
  renderAll();
}

async function ensurePlayerAssigned() {
  if (isGodOverrideRoom()) return;
  const m = activeMembership();
  if (!m || m.player_id) return;
  const { data: taken } = await auth.client.rpc('get_taken_players', { p_room_id: auth.activeRoomId });
  const takenList = taken || [];
  const available = playerIds().filter(id => !takenList.includes(id));
  if (available.length === 0) {
    await setMyPlayer('unassigned');
    showToast("All Bros are taken — you've been set to Unassigned (view only)");
  } else {
    switchTab('settings');
    showToast('Pick which Bro you are to get started');
  }
}

async function fetchRoomMembers() {
  const { data: memberships, error } = await auth.client.from('room_memberships').select('user_id, role, player_id').eq('room_id', auth.activeRoomId);
  if (error || !memberships) return [];
  const ids = memberships.map(m => m.user_id);
  const { data: profiles } = await auth.client.from('profiles').select('id, username').in('id', ids);
  return memberships.map(m => ({
    userId: m.user_id, role: m.role, playerId: m.player_id,
    username: ((profiles || []).find(p => p.id === m.user_id) || {}).username || '(unknown)'
  }));
}

async function setMemberRole(userId, role) {
  const { error } = await auth.client.rpc('set_member_role', { p_room_id: auth.activeRoomId, p_user_id: userId, p_role: role });
  if (error) { showToast('Could not change role'); return; }
  showToast('Role updated');
  loadAndRenderMembers();
}

async function setMemberPlayer(userId, playerId) {
  const { error } = await auth.client.rpc('admin_set_member_player', { p_room_id: auth.activeRoomId, p_user_id: userId, p_player_id: playerId });
  if (error) { showToast(/PLAYER_TAKEN/.test(error.message) ? 'That Bro is already taken' : 'Could not change assignment'); loadAndRenderMembers(); return; }
  showToast('Bro assignment updated');
  loadAndRenderMembers();
  if (userId === auth.session.user.id) renderAccountSection();
}

async function updateRoomSettings(name, password) {
  const { error } = await auth.client.rpc('update_room_settings', { p_room_id: auth.activeRoomId, p_name: name || null, p_password: password || '' });
  if (error) { showToast('Could not save — are you the admin?'); return; }
  await loadMyRooms();
  if (auth.godOverrideRoomMeta) auth.godOverrideRoomMeta.name = name;
  showToast('Room settings saved');
  renderAccountSection();
  renderAdminSettings();
}

async function loadAndRenderMembers() {
  const listEl = document.getElementById('roomMembersList');
  if (!listEl) return;
  const members = await fetchRoomMembers();
  const myUserId = auth.session.user.id;
  const allPlayers = playerIds();
  listEl.innerHTML = members.map(m => {
    const takenByOthers = members.filter(o => o.userId !== m.userId && o.playerId && o.playerId !== 'unassigned').map(o => o.playerId);
    let playerOpts = `<option value="unassigned" ${(!m.playerId || m.playerId === 'unassigned') ? 'selected' : ''}>Unassigned</option>`;
    playerOpts += allPlayers.filter(id => !takenByOthers.includes(id) || id === m.playerId)
      .map(id => `<option value="${id}" ${m.playerId === id ? 'selected' : ''}>${playerName(id)}</option>`).join('');
    return `<div class="stat-line" style="align-items:center; flex-wrap:wrap; gap:8px;">
      <span>${escapeHtml(m.username)}${m.userId === myUserId ? ' <span class="you-badge">You</span>' : ''}</span>
      <span style="display:flex; gap:6px;">
        <select class="memberPlayerSelect" data-user="${m.userId}" style="width:auto; padding:6px 10px; font-size:0.78rem; border-radius:8px; border:1.5px solid rgba(28,61,46,0.25);">${playerOpts}</select>
        <select class="memberRoleSelect" data-user="${m.userId}" ${m.userId === myUserId ? 'disabled' : ''} style="width:auto; padding:6px 10px; font-size:0.78rem; border-radius:8px; border:1.5px solid rgba(28,61,46,0.25);">
          <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>Admin</option>
          <option value="editor" ${m.role === 'editor' ? 'selected' : ''}>Can Edit</option>
          <option value="viewer" ${m.role === 'viewer' ? 'selected' : ''}>View Only</option>
        </select>
      </span>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.memberRoleSelect').forEach(sel => {
    sel.addEventListener('change', () => setMemberRole(sel.dataset.user, sel.value));
  });
  listEl.querySelectorAll('.memberPlayerSelect').forEach(sel => {
    sel.addEventListener('change', () => setMemberPlayer(sel.dataset.user, sel.value));
  });
}

/* ---------------------------------------------------------------
   SEASON NAVIGATION — Previous / Next year
---------------------------------------------------------------- */
let liveRoomState = null;
let viewingSeasonKey = null; // null = live/current year; else the archivedAt of the season being viewed

function isViewingLive() { return viewingSeasonKey === null; }
function sortedArchivedSeasons() {
  return (liveRoomState || state).archivedSeasons.slice().sort((a, b) => {
    const na = parseInt(a.year, 10), nb = parseInt(b.year, 10);
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    return (a.archivedAt || 0) - (b.archivedAt || 0);
  });
}
function enterSeason(season) {
  state = { config: season.config, rounds: season.rounds, archivedSeasons: [], year: season.year, unlocked: false };
  viewingSeasonKey = season.archivedAt;
}

function navigateSeason(dir) {
  const seasons = sortedArchivedSeasons();
  if (isViewingLive()) {
    if (dir < 0 && seasons.length) {
      liveRoomState = state;
      enterSeason(seasons[seasons.length - 1]);
    }
    renderAll();
    return;
  }
  const idx = seasons.findIndex(s => s.archivedAt === viewingSeasonKey);
  if (idx === -1) { // season vanished (e.g. deleted elsewhere) — fall back to live safely
    state = liveRoomState || state; liveRoomState = null; viewingSeasonKey = null;
    renderAll();
    return;
  }
  if (dir < 0) {
    if (idx > 0) enterSeason(seasons[idx - 1]);
  } else if (idx < seasons.length - 1) {
    enterSeason(seasons[idx + 1]);
  } else {
    state = liveRoomState; liveRoomState = null; viewingSeasonKey = null;
  }
  renderAll();
}

async function archiveAndStartNewYear(newYearLabel) {
  state.archivedSeasons.push({ year: state.year, config: JSON.parse(JSON.stringify(state.config)), rounds: JSON.parse(JSON.stringify(state.rounds)), archivedAt: Date.now() });
  const oldYear = state.year;
  state.year = newYearLabel;
  state.rounds = defaultRounds();
  saveState();
  renderAll();
  showToast(`Archived ${oldYear} — welcome to ${newYearLabel}!`);
}

function addBacklogYear(label) {
  if (state.archivedSeasons.some(s => String(s.year) === String(label))) { showToast('That year already exists'); return; }
  const fresh = emptyRoomState();
  fresh.config.players = JSON.parse(JSON.stringify(state.config.players));
  state.archivedSeasons.push({ year: label, config: fresh.config, rounds: fresh.rounds, archivedAt: Date.now() });
  saveState();
  renderAll();
  showToast(`Added ${label} — use the ‹ › arrows on Home to open and fill it in`);
}

function renderSeasonNav() {
  const el = document.getElementById('seasonHistoryWidget');
  if (!el) return;
  if (!appReady()) { el.innerHTML = ''; return; }
  const seasons = sortedArchivedSeasons();
  if (!seasons.length) { el.innerHTML = ''; return; }
  const label = isViewingLive() ? `${state.year} (Live)` : state.year;
  const idx = isViewingLive() ? -1 : seasons.findIndex(s => s.archivedAt === viewingSeasonKey);
  const canPrev = isViewingLive() ? seasons.length > 0 : idx > 0;
  const canNext = !isViewingLive();
  el.innerHTML = `<div class="season-nav">
    <button class="round-nav-btn" id="seasonPrevBtn" ${canPrev ? '' : 'disabled'} aria-label="Previous year">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
    <span class="season-nav-label">${escapeHtml(label)}${!isViewingLive() ? (isAdmin() ? ' <small>editing</small>' : ' <small>read-only</small>') : ''}</span>
    <button class="round-nav-btn" id="seasonNextBtn" ${canNext ? '' : 'disabled'} aria-label="Next year">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  </div>`;
  const prevBtn = document.getElementById('seasonPrevBtn');
  const nextBtn = document.getElementById('seasonNextBtn');
  if (prevBtn) prevBtn.addEventListener('click', () => navigateSeason(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => navigateSeason(1));
}

function setSyncDot(cls) {
  const el = document.getElementById('syncDot');
  if (el) el.className = 'sync-dot' + (cls ? (' ' + cls) : '');
}

/* ---------------------------------------------------------------
   RENDERING — ACCOUNT & ROOMS
---------------------------------------------------------------- */
function renderAccountSection() {
  const el = document.getElementById('accountSection');
  if (!el) return;

  if (!auth.ready) { el.innerHTML = `<div class="account-card"><p class="helper-text" style="margin:0;">Loading…</p></div>`; return; }

  if (auth.sdkFailed) {
    el.innerHTML = `<div class="account-card"><p class="helper-text" style="margin:0; color:#A5432F;">Could not load the login system — check your connection and reload.</p></div>`;
    return;
  }

  if (pendingRecovery) {
    el.innerHTML = `<div class="account-card">
      <p class="helper-text" style="margin:0 0 10px;">Set a new password for your account.</p>
      <div class="field"><label>New Password</label><input type="password" id="newPasswordInput" autocomplete="new-password"></div>
      <button class="btn btn-primary btn-block" id="submitNewPasswordBtn">Set New Password</button>
    </div>`;
    document.getElementById('submitNewPasswordBtn').addEventListener('click', () => submitNewPassword(document.getElementById('newPasswordInput').value));
    return;
  }

  if (!auth.session) {
    el.innerHTML = `<div class="account-card">
      <p class="helper-text" style="margin:0 0 10px;">Create an account (or log in) to get started. This is separate from any room's master PIN.</p>
      <div class="segmented" id="authModeSegmented">
        <button data-mode="login" class="active">Log In</button>
        <button data-mode="signup">Sign Up</button>
      </div>
      <div class="field"><label>Username or Email</label><input type="text" id="authUsernameInput" autocapitalize="none" autocomplete="username"></div>
      <div class="field" id="authEmailField" style="display:none;"><label>Email</label><input type="email" id="authEmailInput" autocomplete="email"></div>
      <div class="field"><label>Password</label><input type="password" id="authPasswordInput" autocomplete="current-password"></div>
      <button class="btn btn-primary btn-block" id="authSubmitBtn">Log In</button>
      <button class="btn btn-ghost btn-block" id="forgotPasswordBtn" style="margin-top:10px;">Forgot password?</button>
    </div>`;
    let mode = 'login';
    el.querySelectorAll('#authModeSegmented button').forEach(b => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      el.querySelectorAll('#authModeSegmented button').forEach(x => x.classList.toggle('active', x === b));
      document.getElementById('authSubmitBtn').textContent = mode === 'login' ? 'Log In' : 'Create Account';
      document.getElementById('authEmailField').style.display = mode === 'signup' ? 'block' : 'none';
      document.getElementById('forgotPasswordBtn').style.display = mode === 'login' ? 'block' : 'none';
    }));
    document.getElementById('authSubmitBtn').addEventListener('click', () => {
      const u = document.getElementById('authUsernameInput').value;
      const p = document.getElementById('authPasswordInput').value;
      if (mode === 'login') logIn(u, p); else signUp(u, document.getElementById('authEmailInput').value, p);
    });
    document.getElementById('forgotPasswordBtn').addEventListener('click', () => requestPasswordReset(document.getElementById('authUsernameInput').value));
    return;
  }

  const username = auth.username || '';
  const ROOM_CAP = 5;

  if (!auth.activeRoomId) {
    let html = signedInCardHtml(username);

    const noRooms = auth.rooms.length === 0;

    if (!noRooms) {
      html += `<div class="card"><p class="eyebrow">Your Rooms (${auth.rooms.length}/${ROOM_CAP})</p>`;
      auth.rooms.forEach(r => {
        const roleLabel = r.role === 'admin' ? 'Admin' : r.role === 'viewer' ? 'View only' : 'Can edit';
        html += `<div class="stat-line" style="align-items:center;">
          <span><b style="font-family:var(--font-display);">${escapeHtml(r.name)}</b><br><span class="helper-text" style="margin:0;">${escapeHtml(r.room_code)} · ${roleLabel}</span></span>
          <span style="display:flex; gap:6px;">
            <button class="btn btn-secondary room-select-btn" data-id="${r.id}" style="padding:8px 14px; font-size:0.78rem;">Open</button>
            <button class="btn btn-ghost room-leave-btn" data-id="${r.id}" data-name="${escapeHtml(r.name)}" style="padding:8px 12px; font-size:0.78rem;">Leave</button>
          </span>
        </div>`;
      });
      if (auth.rooms.length < ROOM_CAP) html += `<button class="btn btn-secondary btn-block" id="showJoinRoomBtn" style="margin-top:14px;">+ Join a New Room</button>`;
      html += `</div>`;
    }

    if (auth.rooms.length < ROOM_CAP) {
      html += `<div class="card" id="joinRoomCard" style="${noRooms ? '' : 'display:none;'}">
        <p class="eyebrow">Join a Room</p>
        <div class="field"><label>Room Code</label><input type="text" id="joinCodeInput" placeholder="e.g. bunker-bros-2027-a1b2"></div>
        <div class="field"><label>Room Password</label><input type="password" id="joinPasswordInput"></div>
        <button class="btn btn-secondary btn-block" id="joinRoomBtn">Join Room</button>
        <button class="btn btn-ghost btn-block" id="showCreateRoomBtn" style="margin-top:14px;">+ Create a New Room Instead</button>
        <div id="createRoomFields" style="display:none; margin-top:14px;">
          <div class="field"><label>Room Name</label><input type="text" id="createNameInput" placeholder="e.g. 2027 Bunker Bros Bonanza"></div>
          <div class="field"><label>Room Password</label><input type="password" id="createPasswordInput" placeholder="Share this with your group"></div>
          <button class="btn btn-primary btn-block" id="createRoomBtn">Create Room</button>
        </div>
      </div>`;
    } else {
      html += `<p class="helper-text">You're in ${ROOM_CAP} rooms already — that's the max. Leave one to add another.</p>`;
    }

    if (auth.isSuperAdmin) html += `<button class="btn btn-secondary btn-block" id="showGodPanelBtn" style="margin-bottom:14px;">⚡ God Mode</button><div id="godPanel"></div>`;

    el.innerHTML = html;
    wireSignedInCard(el);
    el.querySelectorAll('.room-select-btn').forEach(b => b.addEventListener('click', () => selectRoom(b.dataset.id)));
    el.querySelectorAll('.room-leave-btn').forEach(b => b.addEventListener('click', () => {
      if (confirm(`Leave "${b.dataset.name}"? You'll need the room code and password to rejoin.`)) leaveRoom(b.dataset.id);
    }));
    const showJoinBtn = document.getElementById('showJoinRoomBtn');
    if (showJoinBtn) showJoinBtn.addEventListener('click', () => {
      const card = document.getElementById('joinRoomCard');
      const nowShown = card.style.display !== 'none';
      card.style.display = nowShown ? 'none' : 'block';
      showJoinBtn.textContent = nowShown ? '+ Join a New Room' : '− Cancel';
      if (!nowShown) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    const joinBtn = document.getElementById('joinRoomBtn');
    if (joinBtn) joinBtn.addEventListener('click', () => joinRoom(document.getElementById('joinCodeInput').value, document.getElementById('joinPasswordInput').value));
    const showCreateBtn = document.getElementById('showCreateRoomBtn');
    if (showCreateBtn) showCreateBtn.addEventListener('click', () => {
      const fields = document.getElementById('createRoomFields');
      const nowShown = fields.style.display !== 'none';
      fields.style.display = nowShown ? 'none' : 'block';
      showCreateBtn.textContent = nowShown ? '+ Create a New Room Instead' : '− Cancel';
    });
    const createBtn = document.getElementById('createRoomBtn');
    if (createBtn) createBtn.addEventListener('click', () => createRoom(document.getElementById('createNameInput').value, document.getElementById('createPasswordInput').value));
    const godBtn = document.getElementById('showGodPanelBtn');
    if (godBtn) godBtn.addEventListener('click', () => toggleGodPanel());
    return;
  }

  // A room is active
  const m = activeMembership();
  const isGodRoom = isGodOverrideRoom();
  const room = isGodRoom ? auth.godOverrideRoomMeta : auth.rooms.find(r => r.id === auth.activeRoomId);
  const roleLabel = isGodRoom ? 'Admin (God Mode)' : m && m.role === 'admin' ? 'Admin' : m && m.role === 'viewer' ? 'View only' : 'Can edit';
  const canPickBro = !isGodRoom && m.player_id === 'unassigned';

  let html = signedInCardHtml(username);
  html += `<div class="card">
    <p class="eyebrow">Current Room · ${roleLabel}</p>
    <p style="font-family:var(--font-display); font-weight:700; font-size:1.05rem; margin:0 0 2px;">${escapeHtml(room ? room.name : '')}</p>
    <p class="helper-text" style="margin:0 0 12px;">Code: ${escapeHtml(room ? room.room_code : '')}</p>
    ${isGodRoom
      ? `<p class="helper-text" style="margin:0;">You're visiting with God Mode admin access — no Bro assignment needed here.</p>`
      : canPickBro
        ? `<div id="ickerWrap"><p class="helper-text" style="margin:0;">Loading…</p></div>`
        : `<div class="field" style="margin-bottom:0;"><label>You're playing as</label><p style="margin:4px 0 0; font-weight:700;">${m && m.player_id === 'unassigned' ? 'Unassigned' : playerName(m.player_id)}</p></div>
           <p class="helper-text" style="margin-top:6px;">Only the room admin can change this now.</p>`}
    <button class="btn btn-secondary btn-block" id="switchRoomBtn" style="margin-top:14px;">Switch Room</button>
  </div>`;

  el.innerHTML = html;
  wireSignedInCard(el);
  document.getElementById('switchRoomBtn').addEventListener('click', switchRoomView);
  if (canPickBro) renderMyPlayerPicker();
}

function signedInCardHtml(username) {
  return `<div class="account-card">
    <div class="logged-in-badge">
      <div class="who"><small>Signed in as</small> ${escapeHtml(username)}</div>
      <button class="btn btn-ghost" id="logoutBtn">Log Out</button>
    </div>
    <button class="btn btn-ghost btn-block" id="showAccountSettingsBtn" style="margin-top:12px;">Change Account Settings</button>
    <div id="accountSettingsFields" style="display:none; margin-top:14px;">
      <div class="field"><label>Change Username</label><input type="text" id="changeUsernameInput" placeholder="${escapeHtml(username)}" autocapitalize="none"></div>
      <button class="btn btn-secondary btn-block" id="changeUsernameBtn">Save Username</button>
      <div class="field" style="margin-top:14px;"><label>Change Password</label><input type="password" id="changePasswordInput" placeholder="New password" autocomplete="new-password"></div>
      <button class="btn btn-secondary btn-block" id="changePasswordBtn">Save Password</button>
      <div class="sand-divider"></div>
      <p class="eyebrow" style="color:var(--rust);">Danger Zone</p>
      <button class="btn btn-ghost btn-block" id="deleteAccountBtn" style="border-color:var(--rust); color:var(--rust);">Delete My Account</button>
    </div>
  </div>`;
}

function wireSignedInCard(el) {
  document.getElementById('logoutBtn').addEventListener('click', logOut);
  const showBtn = document.getElementById('showAccountSettingsBtn');
  showBtn.addEventListener('click', () => {
    const fields = document.getElementById('accountSettingsFields');
    const nowShown = fields.style.display !== 'none';
    fields.style.display = nowShown ? 'none' : 'block';
    showBtn.textContent = nowShown ? 'Change Account Settings' : '− Cancel';
  });
  document.getElementById('changeUsernameBtn').addEventListener('click', () => changeUsername(document.getElementById('changeUsernameInput').value));
  document.getElementById('changePasswordBtn').addEventListener('click', () => {
    changePassword(document.getElementById('changePasswordInput').value);
    document.getElementById('changePasswordInput').value = '';
  });
  document.getElementById('deleteAccountBtn').addEventListener('click', () => confirmDeleteAccount());
}

async function renderMyPlayerPicker() {
  const m = activeMembership();
  if (!document.getElementById('myPlayerPickerWrap')) return;
  const { data: taken } = await auth.client.rpc('get_taken_players', { p_room_id: auth.activeRoomId });
  const wrap = document.getElementById('myPlayerPickerWrap'); // re-fetch: a re-render may have replaced it while we awaited
  if (!wrap) return;
  const takenList = taken || [];
  const myId = m ? m.player_id : null;
  const available = playerIds().filter(id => !takenList.includes(id) || id === myId);
  let optsHtml = `<option value="unassigned" ${(!myId || myId === 'unassigned') ? 'selected' : ''}>Unassigned</option>`;
  optsHtml += available.map(id => `<option value="${id}" ${myId === id ? 'selected' : ''}>${playerName(id)}</option>`).join('');
  wrap.innerHTML = `<div class="field" style="margin-bottom:10px;"><label>Which Bro are you in this room?</label><select id="myPlayerSelect">${optsHtml}</select></div>
    <button class="btn btn-secondary btn-block" id="saveMyPlayerBtn">Save</button>`;
  const saveBtn = document.getElementById('saveMyPlayerBtn');
  if (saveBtn) saveBtn.addEventListener('click', () => setMyPlayer(document.getElementById('myPlayerSelect').value));
}

function confirmDeleteAccount() {
  const typed = prompt(`This permanently deletes your account and removes you from every room. This cannot be undone.\n\nType your username ("${auth.username}") to confirm:`);
  if (typed !== auth.username) { if (typed !== null) showToast('Did not match — account not deleted'); return; }
  deleteMyAccount();
}

let godPanelOpen = false;
function toggleGodPanel() {
  godPanelOpen = !godPanelOpen;
  const btn = document.getElementById('showGodPanelBtn');
  if (btn) btn.textContent = godPanelOpen ? '⚡ Hide God Mode' : '⚡ God Mode';
  if (godPanelOpen) renderGodPanel(); else document.getElementById('godPanel').innerHTML = '';
}

async function renderGodPanel() {
  const el = document.getElementById('godPanel');
  if (!el) return;
  el.innerHTML = `<p class="helper-text">Loading…</p>`;
  const [{ data: rooms, error: roomsErr }, { data: accounts, error: acctErr }] = await Promise.all([
    auth.client.rpc('super_list_rooms'),
    auth.client.rpc('super_list_accounts')
  ]);
  let html = `<div class="card"><p class="eyebrow">All Rooms (${roomsErr ? '?' : (rooms || []).length})</p>`;
  (rooms || []).forEach(r => {
    html += `<div class="stat-line" style="align-items:center; flex-wrap:wrap; gap:6px;">
      <span><b>${escapeHtml(r.name)}</b><br><span class="helper-text" style="margin:0;">${escapeHtml(r.room_code)} · ${r.member_count} member${r.member_count == 1 ? '' : 's'}</span></span>
      <span style="display:flex; gap:6px;">
        <button class="btn btn-secondary god-open-room" data-id="${r.id}" data-name="${escapeHtml(r.name)}" data-code="${escapeHtml(r.room_code)}" style="padding:6px 12px; font-size:0.72rem;">Open as Admin</button>
        <button class="btn btn-ghost god-delete-room" data-id="${r.id}" data-name="${escapeHtml(r.name)}" style="border-color:var(--rust); color:var(--rust); padding:6px 12px; font-size:0.72rem;">Delete</button>
      </span>
    </div>`;
  });
  html += `</div><div class="card"><p class="eyebrow">All Accounts (${acctErr ? '?' : (accounts || []).length})</p>`;
  (accounts || []).forEach(a => {
    html += `<div class="stat-line" style="align-items:center;">
      <span><b>${escapeHtml(a.username)}</b><br><span class="helper-text" style="margin:0;">${escapeHtml(a.email || '')} · ${a.room_count} room${a.room_count == 1 ? '' : 's'}</span></span>
      <button class="btn btn-ghost god-delete-account" data-id="${a.id}" data-name="${escapeHtml(a.username)}" style="border-color:var(--rust); color:var(--rust); padding:6px 12px; font-size:0.72rem;">Delete</button>
    </div>`;
  });
  html += `</div>`;
  el.innerHTML = html;
  el.querySelectorAll('.god-open-room').forEach(b => b.addEventListener('click', () => enterRoomAsGod(b.dataset.id, b.dataset.name, b.dataset.code)));
  el.querySelectorAll('.god-delete-room').forEach(b => b.addEventListener('click', async () => {
    const typed = prompt(`Type the room name ("${b.dataset.name}") to permanently delete it for everyone:`);
    if (typed !== b.dataset.name) { if (typed !== null) showToast('Did not match'); return; }
    const { error } = await auth.client.rpc('super_delete_room', { p_room_id: b.dataset.id });
    if (error) showToast('Could not delete room'); else { showToast('Room deleted'); renderGodPanel(); }
  }));
  el.querySelectorAll('.god-delete-account').forEach(b => b.addEventListener('click', async () => {
    const typed = prompt(`Type the username ("${b.dataset.name}") to permanently delete that account:`);
    if (typed !== b.dataset.name) { if (typed !== null) showToast('Did not match'); return; }
    const { error } = await auth.client.rpc('super_delete_account', { p_user_id: b.dataset.id });
    if (error) showToast('Could not delete account'); else { showToast('Account deleted'); renderGodPanel(); }
  }));
}

/* ---------------------------------------------------------------
   READY GATE — force Settings until signed in with an active room
---------------------------------------------------------------- */
function applyReadyGate() {
  const ready = appReady();
  document.getElementById('settingsRevealWrap').style.display = ready ? 'block' : 'none';
  if (!ready) {
    switchTab('settings');
  }
}

/* ---------------------------------------------------------------
   RENDERING — MASTER SETTINGS
---------------------------------------------------------------- */
function courseCard(roundIdx, dis) {
  dis = dis || '';
  const c = courseFor(roundIdx);
  return `<div class="card"><p class="eyebrow">Round ${roundIdx} Course</p>
    <div class="field"><label>Course Name</label><input type="text" class="cfgCourseName" data-round="${roundIdx}" value="${escapeHtml(c.name)}" ${dis}></div>
    <div class="field-row">
      <div class="field"><label>Closest to the Pin — Hole #</label><input type="number" min="1" max="18" class="cfgCtpHole" data-round="${roundIdx}" value="${c.ctpHole}" ${dis}></div>
      <div class="field"><label>Longest Drive — Hole #</label><input type="number" min="1" max="18" class="cfgLdHole" data-round="${roundIdx}" value="${c.ldHole}" ${dis}></div>
    </div>
    <p class="eyebrow" style="margin-top:10px;">Pars &amp; Stroke Index</p>
    <div class="hole-grid">${c.holes.map((h, i) => `
      <div class="field hole-par-input">
        <label>Hole ${h.number}</label>
        <input type="number" class="cfgHolePar" data-round="${roundIdx}" data-hole-idx="${i}" value="${h.par}" style="margin-bottom:4px;" ${dis}>
        <input type="number" class="cfgHoleIndex" data-round="${roundIdx}" data-hole-idx="${i}" value="${h.index}" ${dis}>
      </div>`).join('')}
    </div>
    <p class="helper-text">Top box = par, bottom box = stroke index.</p>
  </div>`;
}

function renderGameSettings() {
  const c = state.config;
  const el = document.getElementById('gameSettingsSection');
  const editable = canEditGameSettings();
  const dis = editable ? '' : 'disabled';
  let html = '';

  if (myRole() && myRole() !== 'viewer') {
    html += `<div class="card"><p class="eyebrow">Export</p>
      <p class="helper-text" style="margin:0 0 10px;">Download every round, hole, score, and point — including all past years — as a spreadsheet-ready CSV.</p>
      <button class="btn btn-secondary btn-block" id="exportCsvBtn">⬇ Export to CSV</button>
    </div>`;
  }

  if (!editable && myRole() === 'editor' && state.config.requirePinForEditors) {
    html += `<div class="card">
      <p class="eyebrow">Master PIN Required</p>
      <p class="helper-text" style="margin:0 0 10px;">Enter the master PIN to edit these settings. You can still view them below.</p>
      <div class="field"><label>PIN</label><input type="password" inputmode="numeric" id="editorPinInput" placeholder="••••"></div>
      <button class="btn btn-primary btn-block" id="editorPinSubmitBtn">Unlock Editing</button>
    </div>`;
  } else if (!editable) {
    html += `<p class="helper-text">You have view-only access — these settings are read-only for you.</p>`;
  }

  html += `<div class="card"><p class="eyebrow">Players</p>`;
  c.players.forEach((p, i) => {
    html += `<div class="field"><label>Player ${i + 1} Name</label><input type="text" data-player-idx="${i}" class="cfgPlayerName" value="${escapeHtml(p.name)}" ${dis}></div>`;
  });
  html += `</div>`;

  html += `<div class="card"><p class="eyebrow">Daily Game Points</p>
    <div class="field-row">
      <div class="field"><label>1st Place</label><input type="number" id="cfgFirst" value="${c.dailyGame.first}" ${dis}></div>
      <div class="field"><label>2nd Place</label><input type="number" id="cfgSecond" value="${c.dailyGame.second}" ${dis}></div>
    </div>
    <p class="helper-text">Ties split the combined points evenly across tied positions.</p>
  </div>`;

  html += `<div class="card"><p class="eyebrow">Stableford Points</p>
    <div class="field-row">
      <div class="field"><label>Bogey</label><input type="number" id="cfgBogey" value="${c.stableford.bogey}" ${dis}></div>
      <div class="field"><label>Par</label><input type="number" id="cfgPar" value="${c.stableford.par}" ${dis}></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Birdie</label><input type="number" id="cfgBirdie" value="${c.stableford.birdie}" ${dis}></div>
      <div class="field"><label>Eagle</label><input type="number" id="cfgEagle" value="${c.stableford.eagle}" ${dis}></div>
    </div>
    <div class="field"><label>Albatross</label><input type="number" id="cfgAlbatross" value="${c.stableford.albatross}" ${dis}></div>
  </div>`;

  html += `<div class="card"><p class="eyebrow">Side Games</p>
    <div class="field"><label>Points per Side Game Win</label><input type="number" id="cfgSideGamePoints" value="${c.sideGamePoints}" ${dis}></div>
    <p class="helper-text">CTP &amp; Longest Drive holes are set per-course below.</p>
  </div>`;

  html += `<div class="card"><p class="eyebrow">Scoring Permissions</p>
    <div class="field" style="display:flex; align-items:center; gap:10px; margin-bottom:0;">
      <input type="checkbox" id="cfgOpenScoring" ${c.openScoring ? 'checked' : ''} style="width:auto;" ${dis}>
      <label style="margin:0; text-transform:none; font-size:0.85rem; font-weight:600; color:var(--ink);">Anyone in this room can edit anyone's score</label>
    </div>
    <p class="helper-text" style="margin-top:8px;">Off by default — normally each Bro can only edit their own strokes once they've picked their player in Account &amp; Rooms.</p>
  </div>`;

  html += `<div class="card"><p class="eyebrow">Wolf Point Allocation (Round 2)</p>
    <div class="field-row">
      <div class="field"><label>Solo/Lone Win</label><input type="number" id="cfgWolfSoloWin" value="${c.wolf.soloWin}" ${dis}></div>
      <div class="field"><label>Team Win (each)</label><input type="number" id="cfgWolfTeamWin" value="${c.wolf.teamWin}" ${dis}></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Opponents Win (each)</label><input type="number" id="cfgWolfOppWin" value="${c.wolf.opponentWin}" ${dis}></div>
      <div class="field"><label>Blind Wolf Multiplier</label><input type="number" step="0.5" id="cfgWolfBlindMult" value="${c.wolf.blindMultiplier}" ${dis}></div>
    </div>
    <p class="helper-text">Blind Wolf = going lone before seeing any tee shots. Whatever the hole's points would be, they're multiplied by this value.</p>
  </div>`;

  html += `<div class="card"><p class="eyebrow">1-1-1 Point Allocation (Round 3)</p>
    <div class="field-row">
      <div class="field"><label>Solo Win</label><input type="number" id="cfg111Solo" value="${c.oneOneOne.soloWin}" ${dis}></div>
      <div class="field"><label>Team Win (each)</label><input type="number" id="cfg111Team" value="${c.oneOneOne.teamWin}" ${dis}></div>
    </div>
  </div>`;

  html += `<div class="card"><p class="eyebrow">Round 1 Best Ball</p>
    <div class="field"><label>Best Ball Score Goal</label><input type="number" id="cfgBestBallGoal" value="${c.bestBallGoal}" ${dis}></div>
  </div>`;

  html += courseCard(1, dis) + courseCard(2, dis) + courseCard(3, dis);

  el.innerHTML = html;
  const exportBtn = document.getElementById('exportCsvBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportRoomCSV);
  const pinBtn = document.getElementById('editorPinSubmitBtn');
  if (pinBtn) {
    pinBtn.addEventListener('click', () => {
      const val = document.getElementById('editorPinInput').value;
      if (val === state.config.pin) { editorPinUnlocked = true; renderAll(); showToast('Unlocked for editing'); }
      else showToast('Incorrect PIN');
    });
  }
  if (!editable) return; // nothing below is interactive

  const bind = (id, path, isNum) => {
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.addEventListener('change', () => { setPath(path, isNum ? Number(inp.value) : inp.value); saveState(); renderAll(); });
  };
  bind('cfgFirst', ['dailyGame', 'first'], true);
  bind('cfgSecond', ['dailyGame', 'second'], true);
  bind('cfgBogey', ['stableford', 'bogey'], true);
  bind('cfgPar', ['stableford', 'par'], true);
  bind('cfgBirdie', ['stableford', 'birdie'], true);
  bind('cfgEagle', ['stableford', 'eagle'], true);
  bind('cfgAlbatross', ['stableford', 'albatross'], true);
  bind('cfgSideGamePoints', ['sideGamePoints'], true);
  const openScoringEl = document.getElementById('cfgOpenScoring');
  if (openScoringEl) openScoringEl.addEventListener('change', () => { state.config.openScoring = openScoringEl.checked; saveState(); renderAll(); });
  bind('cfgWolfSoloWin', ['wolf', 'soloWin'], true);
  bind('cfgWolfTeamWin', ['wolf', 'teamWin'], true);
  bind('cfgWolfOppWin', ['wolf', 'opponentWin'], true);
  bind('cfgWolfBlindMult', ['wolf', 'blindMultiplier'], true);
  bind('cfg111Solo', ['oneOneOne', 'soloWin'], true);
  bind('cfg111Team', ['oneOneOne', 'teamWin'], true);
  bind('cfgBestBallGoal', ['bestBallGoal'], true);

  el.querySelectorAll('.cfgPlayerName').forEach(inp => {
    inp.addEventListener('change', () => { state.config.players[Number(inp.dataset.playerIdx)].name = inp.value; saveState(); renderAll(); });
  });
  el.querySelectorAll('.cfgCourseName').forEach(inp => {
    inp.addEventListener('change', () => { courseFor(Number(inp.dataset.round)).name = inp.value; saveState(); renderAll(); });
  });
  el.querySelectorAll('.cfgCtpHole').forEach(inp => {
    inp.addEventListener('change', () => { courseFor(Number(inp.dataset.round)).ctpHole = Number(inp.value); saveState(); renderAll(); });
  });
  el.querySelectorAll('.cfgLdHole').forEach(inp => {
    inp.addEventListener('change', () => { courseFor(Number(inp.dataset.round)).ldHole = Number(inp.value); saveState(); renderAll(); });
  });
  el.querySelectorAll('.cfgHolePar').forEach(inp => {
    inp.addEventListener('change', () => { courseFor(Number(inp.dataset.round)).holes[Number(inp.dataset.holeIdx)].par = Number(inp.value); saveState(); renderAll(); });
  });
  el.querySelectorAll('.cfgHoleIndex').forEach(inp => {
    inp.addEventListener('change', () => { courseFor(Number(inp.dataset.round)).holes[Number(inp.dataset.holeIdx)].index = Number(inp.value); saveState(); renderAll(); });
  });
}

function renderAdminSettings() {
  const el = document.getElementById('adminSettingsSection');
  if (!isAdmin()) { el.innerHTML = ''; return; }
  const c = state.config;
  const room = auth.rooms.find(r => r.id === auth.activeRoomId) || auth.godOverrideRoomMeta || {};
  let html = '';

  html += `<div class="sand-divider"></div><p class="eyebrow">Admin Only</p>`;

  html += `<div class="card"><p class="eyebrow">Room</p>
    <div class="field"><label>Room Name</label><input type="text" id="cfgRoomName" value="${escapeHtml(room.name || '')}"></div>
    <div class="field"><label>Room Password</label><input type="password" id="cfgRoomPassword" placeholder="Leave blank to keep current password"></div>
    <button class="btn btn-secondary btn-block" id="saveRoomSettingsBtn">Save Room Settings</button>
    <p class="helper-text" style="margin-top:8px;">Code: ${escapeHtml(room.room_code || '')}</p>
  </div>`;

  html += `<div class="card"><p class="eyebrow">Members &amp; Permissions</p>
    <div id="roomMembersList"><p class="helper-text" style="margin:0;">Loading…</p></div>
    <p class="helper-text" style="margin-top:8px;">Left dropdown is who they're playing as; right is their permission. "Can Edit" plays and enters scores. "View Only" can watch but not touch anything. Admins keep their admin status even if set to Unassigned.</p>
  </div>`;

  html += `<div class="card"><p class="eyebrow">Master PIN</p>
    <div class="field"><label>PIN</label><input type="text" id="cfgPin" value="${escapeHtml(c.pin)}"></div>
    <div class="field" style="display:flex; align-items:center; gap:10px; margin-bottom:0;">
      <input type="checkbox" id="cfgRequirePin" ${c.requirePinForEditors ? 'checked' : ''} style="width:auto;">
      <label style="margin:0; text-transform:none; font-size:0.85rem; font-weight:600; color:var(--ink);">Require this PIN for editors to change settings</label>
    </div>
    <p class="helper-text" style="margin-top:8px;">Turn this off to let anyone with "Can Edit" access change game settings without a PIN. Admins never need it.</p>
  </div>`;

  html += `<div class="card"><p class="eyebrow">Season Archive</p>
    <p class="helper-text" style="margin:0 0 10px;">Current year: <b>${escapeHtml(state.year)}</b>. Archiving snapshots this year's final scores, then clears the scorecards for the next trip. Everyone can browse archived years from Home using the ‹ › arrows, and you can edit past years there too.</p>
    <button class="btn btn-secondary btn-block" id="startNewYearBtn">Archive "${escapeHtml(state.year)}" &amp; Start New Year</button>
    <button class="btn btn-ghost btn-block" id="addBacklogYearBtn" style="margin-top:10px;">+ Add a Past Year (Backfill)</button>
    <p class="helper-text" style="margin-top:8px;">Adds a blank year to the archive so you can go fill in old scores you never entered — use the ‹ › arrows on Home to open it.</p>
  </div>`;

  html += `<div class="card"><p class="eyebrow" style="color:var(--rust);">Danger Zone</p>
    <button class="btn btn-ghost btn-block" id="deleteRoomBtn" style="border-color:var(--rust); color:var(--rust);">Delete This Room</button>
    <p class="helper-text" style="margin-top:8px;">Removes the room and everyone's access to it, permanently.</p>
  </div>`;

  el.innerHTML = html;

  document.getElementById('cfgPin').addEventListener('change', (e) => { state.config.pin = e.target.value; saveState(); });
  document.getElementById('cfgRequirePin').addEventListener('change', (e) => { state.config.requirePinForEditors = e.target.checked; saveState(); renderAll(); });
  document.getElementById('saveRoomSettingsBtn').addEventListener('click', () => {
    updateRoomSettings(document.getElementById('cfgRoomName').value, document.getElementById('cfgRoomPassword').value);
  });
  loadAndRenderMembers();
  document.getElementById('startNewYearBtn').addEventListener('click', () => {
    const guess = (() => { const n = parseInt(state.year, 10); return isNaN(n) ? '' : String(n + 1); })();
    const label = prompt('Label for the new year (e.g. "2028"):', guess);
    if (!label) return;
    if (!confirm(`Archive "${state.year}" and reset all scores for "${label}"? This can't be undone.`)) return;
    archiveAndStartNewYear(label);
  });
  document.getElementById('addBacklogYearBtn').addEventListener('click', () => {
    const label = prompt('Which year are you backfilling? (e.g. "2023")');
    if (!label) return;
    addBacklogYear(label);
  });
  document.getElementById('deleteRoomBtn').addEventListener('click', () => {
    const typed = prompt(`This permanently deletes "${room.name}" for everyone. This cannot be undone.\n\nType the room name to confirm:`);
    if (typed !== room.name) { if (typed !== null) showToast('Did not match — room not deleted'); return; }
    deleteActiveRoom();
  });
}

async function deleteActiveRoom() {
  const { error } = await auth.client.rpc('delete_room', { p_room_id: auth.activeRoomId });
  if (error) { showToast('Could not delete room'); return; }
  if (cloudSync.channel) { auth.client.removeChannel(cloudSync.channel); cloudSync.channel = null; }
  auth.activeRoomId = null;
  auth.godOverrideRoomId = null; auth.godOverrideRoomMeta = null;
  localStorage.removeItem(ACTIVE_ROOM_KEY);
  state = emptyRoomState();
  await loadMyRooms();
  renderAll();
  applyReadyGate();
  showToast('Room deleted');
}

function setPath(path, value) {
  let obj = state.config;
  for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]];
  obj[path[path.length - 1]] = value;
}

/* ---------------------------------------------------------------
   TAB NAVIGATION
---------------------------------------------------------------- */
let settingsPanelsOpen = false;

function renderAll() {
  renderHeader();
  renderSeasonNav();
  renderRoundStatus();
  renderLeaderboard();
  renderRoundsView();
  renderStats();
  renderAccountSection();
  if (settingsPanelsOpen && appReady()) { renderGameSettings(); renderAdminSettings(); }
}

document.getElementById('showSettingsBtn').addEventListener('click', () => {
  settingsPanelsOpen = !settingsPanelsOpen;
  const panels = document.getElementById('settingsPanels');
  const btn = document.getElementById('showSettingsBtn');
  panels.style.display = settingsPanelsOpen ? 'block' : 'none';
  btn.textContent = settingsPanelsOpen ? 'Hide Settings' : 'Show Settings';
  if (settingsPanelsOpen) { renderGameSettings(); renderAdminSettings(); }
});

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tab}`));
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.getElementById('roundSegmented').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-round]');
  if (!btn) return;
  activeRoundTab = Number(btn.dataset.round);
  renderRoundsView();
});

/* ---------------------------------------------------------------
   SCORE ENTRY MODAL
---------------------------------------------------------------- */
let modalRound = 1;
let modalHole = 1;

function firstUnenteredHole(round) {
  const ids = playerIds();
  for (let n = 1; n <= 18; n++) {
    if (!allEntered(round.holes[n], ids)) return n;
  }
  return null; // this round is fully complete
}

function openScoreModal() {
  let round = activeRoundTab;
  let hole = firstUnenteredHole(state.rounds[round - 1]);
  if (hole == null) {
    // this round is done — look for the next round (in order) with open holes
    for (let i = 1; i <= 3; i++) {
      const r = ((round - 1 + i) % 3) + 1;
      const h = firstUnenteredHole(state.rounds[r - 1]);
      if (h != null) { round = r; hole = h; break; }
    }
    if (hole == null) hole = 18; // every round is fully complete — just show something
  }
  modalRound = round;
  modalHole = hole;
  document.getElementById('scoreModal').classList.remove('hidden');
  document.querySelectorAll('#modalRoundSegmented button').forEach(b => b.classList.toggle('active', Number(b.dataset.round) === modalRound));

  const gate = document.getElementById('modalLoginGate');
  const body = document.getElementById('modalScoreBody');
  if (!canEditAnyScore()) {
    const gateText = document.getElementById('modalLoginGateText');
    if (!isViewingLive()) gateText.textContent = `You're viewing ${state.year} in read-only mode. Jump back to the live year on Home to enter scores.`;
    else if (appReady() && myRole() === 'viewer') gateText.textContent = `You have view-only access to this room — ask the admin to change your permission if you need to enter scores.`;
    else gateText.textContent = `You need to sign in and join or create a room before you can enter scores. Head to Settings → Account & Rooms.`;
    gate.style.display = 'block';
    body.style.display = 'none';
    return;
  }
  gate.style.display = 'none';
  body.style.display = 'block';
  renderModalHole();
}
function closeScoreModal() { document.getElementById('scoreModal').classList.add('hidden'); }

document.getElementById('fabScoreEntry').addEventListener('click', openScoreModal);
document.getElementById('closeModalBtn').addEventListener('click', closeScoreModal);
document.getElementById('scoreModal').addEventListener('click', (e) => { if (e.target.id === 'scoreModal') closeScoreModal(); });
document.getElementById('modalGoToLoginBtn').addEventListener('click', () => { closeScoreModal(); switchTab('settings'); });

document.getElementById('modalRoundSegmented').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-round]');
  if (!btn) return;
  modalRound = Number(btn.dataset.round);
  modalHole = firstUnenteredHole(state.rounds[modalRound - 1]) ?? 18;
  document.querySelectorAll('#modalRoundSegmented button').forEach(b => b.classList.toggle('active', Number(b.dataset.round) === modalRound));
  renderModalHole();
});

document.getElementById('prevHoleBtn').addEventListener('click', () => { if (modalHole > 1) { modalHole--; renderModalHole(); } });
document.getElementById('nextHoleBtn').addEventListener('click', () => { if (modalHole < 18) { modalHole++; renderModalHole(); } });

function wolfChoiceLabel(round, n, value) {
  const { wolf, first, second } = getWolfOrderForHole(round, n);
  if (value === 'lone') return `Lone Wolf`;
  if (value === 'blind') return `Blind Wolf (2x)`;
  if (value === 'first') return `Team w/ ${playerName(first)} (1st off)`;
  if (value === 'second') return `Team w/ ${playerName(second)} (2nd off)`;
  return value;
}

function renderModalHole() {
  const round = state.rounds[modalRound - 1];
  const hd = round.holes[modalHole];
  const par = holeConfig(modalRound, modalHole).par;
  const ids = playerIds();
  const loggedInId = myPlayerId();

  document.getElementById('modalRoundTitle').textContent = `${round.label} · ${round.gameName}`;
  document.getElementById('modalHoleNumber').textContent = `Hole ${modalHole}`;
  document.getElementById('modalHolePar').textContent = `Par ${par}`;

  const saveBtn = document.getElementById('saveHoleBtn');
  const alreadyEntered = allEntered(hd, ids);
  saveBtn.textContent = alreadyEntered ? 'Edit Hole' : 'Save Hole';
  saveBtn.classList.toggle('btn-primary', !alreadyEntered);
  saveBtn.classList.toggle('btn-edit', alreadyEntered);

  const notice = document.getElementById('modalLoginNotice');
  notice.style.display = 'block';
  notice.textContent = isAdmin()
    ? `Admin mode — all strokes are editable.`
    : state.config.openScoring
      ? `Open scoring is on for this room — anyone can edit any player's strokes.`
      : loggedInId
        ? `Playing as ${playerName(loggedInId)} — only your strokes are editable.`
        : `Pick which player you are in Account & Rooms to unlock your strokes.`;

  // Wolf order block (hole 1, round 2 only)
  const wolfOrderBlock = document.getElementById('modalWolfOrderBlock');
  if (round.type === 'wolf' && modalHole === 1) {
    wolfOrderBlock.style.display = 'block';
    const order = (round.wolfOrder && round.wolfOrder.length === 3) ? round.wolfOrder : playerIds();
    const orderDiv = document.getElementById('modalWolfOrderInputs');
    orderDiv.innerHTML = [0, 1, 2].map(pos => `
      <div class="field"><label>Position ${pos + 1}</label>
        <select class="wolfOrderSelect" data-pos="${pos}">
          ${ids.map(id => `<option value="${id}" ${order[pos] === id ? 'selected' : ''}>${playerName(id)}</option>`).join('')}
        </select>
      </div>`).join('');
    orderDiv.querySelectorAll('.wolfOrderSelect').forEach(sel => {
      sel.addEventListener('change', () => {
        const newOrder = Array.from(orderDiv.querySelectorAll('.wolfOrderSelect')).map(s => s.value);
        round.wolfOrder = newOrder;
        saveState();
        renderModalHole();
      });
    });
  } else {
    wolfOrderBlock.style.display = 'none';
  }

  const inputsDiv = document.getElementById('modalScoreInputs');
  inputsDiv.innerHTML = ids.map(id => {
    const val = hd[id] != null ? hd[id] : par;
    const locked = !canEditPlayer(id);
    return `<div class="score-input-row ${locked ? 'locked-row' : ''}">
      <label>${playerName(id)}${loggedInId === id ? '<span class="you-badge">You</span>' : ''}</label>
      <div class="stepper">
        <button type="button" class="stepDown" data-player="${id}" ${locked ? 'disabled' : ''}>−</button>
        <input type="number" class="scoreVal" data-player="${id}" value="${val}" min="1" max="15" ${locked ? 'disabled' : ''}>
        <button type="button" class="stepUp" data-player="${id}" ${locked ? 'disabled' : ''}>+</button>
      </div>
    </div>`;
  }).join('');

  inputsDiv.querySelectorAll('.stepDown').forEach(b => b.addEventListener('click', () => stepScore(b.dataset.player, -1)));
  inputsDiv.querySelectorAll('.stepUp').forEach(b => b.addEventListener('click', () => stepScore(b.dataset.player, 1)));
  inputsDiv.querySelectorAll('.scoreVal').forEach(inp => inp.addEventListener('change', renderModalPreview));

  const wolfBlock = document.getElementById('modalWolfBlock');
  const matchupBlock = document.getElementById('modalMatchupBlock');

  if (round.type === 'wolf') {
    wolfBlock.style.display = 'block';
    matchupBlock.style.display = 'none';
    const { wolf: wolfPlayer, first, second } = getWolfOrderForHole(round, modalHole);
    document.getElementById('modalWolfWhoText').textContent = `${playerName(wolfPlayer)} is the wolf this hole.`;
    const current = hd.wolf ? hd.wolf.partner : 'lone';
    const opts = document.getElementById('modalWolfOptions');
    const choices = ['blind', 'first', 'second', 'lone'];
    opts.innerHTML = choices.map(v => `<label class="radio-chip"><input type="radio" name="wolfChoice" value="${v}" ${current === v ? 'checked' : ''}><span>${wolfChoiceLabel(round, modalHole, v)}</span></label>`).join('');
    opts.querySelectorAll('input').forEach(inp => inp.addEventListener('change', renderModalPreview));
  } else if (round.type === '111') {
    wolfBlock.style.display = 'none';
    matchupBlock.style.display = 'block';
    const soloPlayer = rotatedPlayer(modalHole, 0);
    const teamIds = ids.filter(id => id !== soloPlayer);
    document.getElementById('modalMatchupTitle').textContent = 'Matchup';
    document.getElementById('modalMatchupText').textContent = `${playerName(soloPlayer)} (solo) vs. ${teamIds.map(playerName).join(' & ')} (team)`;
  } else {
    wolfBlock.style.display = 'none';
    matchupBlock.style.display = 'none';
  }

  renderModalPreview();
}

function stepScore(playerId, delta) {
  const inp = document.querySelector(`.scoreVal[data-player="${playerId}"]`);
  if (inp.disabled) return;
  const next = Math.max(1, Math.min(15, Number(inp.value) + delta));
  inp.value = next;
  renderModalPreview();
}

function readModalTempHole() {
  const ids = playerIds();
  const temp = {};
  ids.forEach(id => {
    const inp = document.querySelector(`.scoreVal[data-player="${id}"]`);
    temp[id] = inp ? Number(inp.value) : null;
  });
  const wolfChoice = document.querySelector('input[name="wolfChoice"]:checked');
  if (wolfChoice) temp.wolf = { partner: wolfChoice.value };
  return temp;
}

function renderModalPreview() {
  const round = state.rounds[modalRound - 1];
  const temp = readModalTempHole();
  const resultBlock = document.getElementById('modalAutoResultBlock');
  const resultTitle = document.getElementById('modalAutoResultTitle');
  const resultText = document.getElementById('modalAutoResultText');
  resultBlock.style.display = 'block';

  if (round.type === 'matchplay3') {
    resultTitle.textContent = 'Match Play Result';
    const pts = matchPlayHolePoints(temp, playerIds());
    if (!pts) { resultText.textContent = 'Enter all three strokes to see the result.'; return; }
    const parts = playerIds().map(id => `${playerName(id)}: ${fmtNum(pts[id])} pt${pts[id] === 1 ? '' : 's'}`);
    resultText.textContent = parts.join(' · ');
  } else if (round.type === 'wolf') {
    resultTitle.textContent = 'Wolf Result';
    const w = wolfHolePoints(temp, modalHole, round);
    if (!w) { resultText.textContent = 'Enter all three strokes to see the result.'; return; }
    const tag = w.blind ? ' (blind — doubled!)' : '';
    if (w.outcome === 'team-win') resultText.textContent = `${w.teamIds.map(playerName).join(' & ')} win the hole${tag}.`;
    else if (w.outcome === 'opp-win') resultText.textContent = `${w.oppIds.map(playerName).join(' & ')} beat the wolf${tag}.`;
    else resultText.textContent = 'Hole tied — no points awarded.';
  } else if (round.type === '111') {
    resultTitle.textContent = '1-1-1 Result';
    const o = oneOneOneHolePoints(temp, modalHole);
    if (!o) { resultText.textContent = 'Enter all three strokes to see the result.'; return; }
    if (o.outcome === 'solo-win') resultText.textContent = `${playerName(o.soloPlayer)} wins solo (+${state.config.oneOneOne.soloWin}).`;
    else if (o.outcome === 'team-win') resultText.textContent = `${o.teamIds.map(playerName).join(' & ')} win as a team (+${state.config.oneOneOne.teamWin} each).`;
    else resultText.textContent = 'Hole tied — no points awarded.';
  }
}

document.getElementById('saveHoleBtn').addEventListener('click', () => {
  const round = state.rounds[modalRound - 1];
  const temp = readModalTempHole();
  const holeData = round.holes[modalHole];
  playerIds().forEach(id => {
    if (!canEditPlayer(id)) return;
    holeData[id] = temp[id];
  });
  if (round.type === 'wolf' && temp.wolf) holeData.wolf = temp.wolf;
  saveState();
  renderRoundsView();
  renderLeaderboard();
  renderRoundStatus();
  renderStats();
  if (modalHole < 18) {
    modalHole++;
    renderModalHole();
    showToast(`Hole ${modalHole - 1} saved`);
  } else {
    showToast('Hole 18 saved — round complete!');
    closeScoreModal();
  }
});

/* ---------------------------------------------------------------
   TOAST
---------------------------------------------------------------- */
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/* ---------------------------------------------------------------
   INIT
---------------------------------------------------------------- */
switchTab('settings');
renderAll();
initSupabaseAuth();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
  });
}
