/* ===================================================================
   BUNKER BROS BONANZA — app logic (v4)
=================================================================== */

const STORAGE_KEY_PREFIX = 'bbBonanzaRoom_v1_';
const ACTIVE_ROOM_KEY = 'bbActiveRoomId_v1';
const SUPABASE_URL = 'https://nsztrhvlzmwtucunktgo.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3qUoihACpekhjQLs4x1t3w_kXDV_Ti4';

function updateHeight() {
  document.documentElement.style.setProperty("--app-height", `${window.innerHeight}px`);
  const isPWA = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (isPWA) { document.body.classList.add("pwa"); document.documentElement.style.setProperty("--bottom-offset", "4px"); }
}
window.addEventListener("resize", updateHeight);
window.addEventListener("orientationchange", updateHeight);
updateHeight();

const bar = document.querySelector(".tab-bar");
function updateBar() {
  if (!window.visualViewport) return;
  const offset = window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop;
  bar.style.transform = `translateY(${offset}px)`;
}
visualViewport.addEventListener("resize", updateBar);
visualViewport.addEventListener("scroll", updateBar);
updateBar();

const tabBar = document.querySelector(".tab-bar");
function updateKeyboardState() {
    if (!window.visualViewport) return;
    const keyboardOpen = window.visualViewport.height < window.innerHeight - 100;
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
function defaultHoles(count) {
  const pars = [4,4,3,4,4,4,4,3,5, 4,3,4,5,3,4,5,4,4];
  const idx  = [1,7,6,14,8,9,2,18,17, 11,13,3,5,10,16,4,12,15];
  const n = count || 18;
  return pars.slice(0, n).map((par, i) => ({ number: i + 1, par, index: idx[i] }));
}

function defaultCourse(name, ctpHole, ldHole, holeCount) {
  const n = holeCount || 18;
  // courseId links this round's course to a shared golf_courses library
  // entry (null = a one-off/custom course not saved to the shared
  // database, e.g. legacy rooms created before this feature existed).
  // holeSet records WHICH 9 (or all 18) of that library course's holes are
  // currently loaded in — '18' | 'front9' | 'back9' — so switching back
  // and forth doesn't lose track of which half was in use.
  return { name, holes: defaultHoles(n), ctpHole, ldHole, holeCount: n, courseId: null, holeSet: n === 18 ? '18' : 'front9' };
}

function resizeCourseHoles(course, newCount) {
  if (newCount === course.holes.length) { course.holeCount = newCount; return; }
  if (newCount > course.holes.length) {
    const defaults = defaultHoles(18);
    for (let n = course.holes.length + 1; n <= newCount; n++) {
      const def = defaults.find(h => h.number === n) || { number: n, par: 4, index: n };
      course.holes.push({ number: n, par: def.par, index: def.index });
    }
  } else {
    course.holes = course.holes.filter(h => h.number <= newCount);
  }
  course.holeCount = newCount;
  if (course.ctpHole > newCount) course.ctpHole = newCount;
  if (course.ldHole > newCount) course.ldHole = newCount;
}

function resizeRoundHoles(round, newCount) {
  const holes = round.holes;
  const currentMax = Math.max(0, ...Object.keys(holes).map(Number));
  if (newCount > currentMax) {
    for (let n = 1; n <= newCount; n++) {
      if (!holes[n]) holes[n] = buildEmptyHole(round);
    }
  } else {
    Object.keys(holes).forEach(k => { if (Number(k) > newCount) delete holes[k]; });
  }
}

// Pulls a 9- or 18-hole par/index layout out of a shared library course
// (which always stores a full 18-hole layout) for a given holeSet
// ('18' | 'front9' | 'back9'), renumbered locally to 1..9 or 1..18 so it
// slots directly into course.holes the same way a hand-entered course
// always has — nothing else in the app needs to know the holes originally
// came from holes 10–18 of the source course.
function holesForSet(libraryHoles, holeSet) {
  const src = (libraryHoles || []).slice().sort((a, b) => a.number - b.number);
  let slice;
  if (holeSet === 'front9') slice = src.slice(0, 9);
  else if (holeSet === 'back9') slice = src.slice(9, 18);
  else slice = src.slice(0, 18);
  return slice.map((h, i) => ({ number: i + 1, par: h.par, index: h.index }));
}

function holeSetLabel(holeSet) {
  if (holeSet === 'front9') return '9 Holes (Front)';
  if (holeSet === 'back9') return '9 Holes (Back)';
  return '18 Holes';
}
function holeSetToCount(holeSet) { return holeSet === '18' ? 18 : 9; }

const MIN_PLAYERS = 2, MAX_PLAYERS = 8;
const MIN_ROUNDS = 1, MAX_ROUNDS = 6;

// Builds a blank hole entry shaped for the round's current type, using
// whatever players are *currently* configured (not the bootstrap p1/p2/p3
// default) — used any time new holes are created on an already-loaded room
// (resizing hole count, adding a round, switching a round's game type).
function buildEmptyHole(round) {
  if (round && round.type === 'scramble') return { team: null };
  const d = {};
  playerIds().forEach(id => d[id] = null);
  if (round && round.type === 'wolf') d.wolf = { partner: 'lone' };
  return d;
}

function defaultConfig() {
  return {
    players: [
      { id: 'p1', name: 'Player 1', handicap: 0 },
      { id: 'p2', name: 'Player 2', handicap: 0 },
      { id: 'p3', name: 'Player 3', handicap: 0 }
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
    skins: { pointValue: 1 },
    bestBallGoal: 84,
    openScoring: false,
    useHandicaps: false,
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
    { id: 1, type: 'matchplay3', label: 'Round 1', gameName: 'Match Play',
      holes: makeHoles(), ctpWinner: null, ldWinner: null, date: null,
      excludeFromLifetime: false, tournamentWinner: null },
    { id: 2, type: 'wolf', label: 'Round 2', gameName: 'Wolf',
      holes: makeHoles(() => ({ wolf: { partner: 'lone' } })), ctpWinner: null, ldWinner: null,
      wolfOrder: ['p1', 'p2', 'p3'], date: null, excludeFromLifetime: false, tournamentWinner: null },
    { id: 3, type: '111', label: 'Round 3', gameName: '6-6-6',
      holes: makeHoles(), ctpWinner: null, ldWinner: null, oneOneOneOrder: ['p1', 'p2', 'p3'], rotateEvery: 6,
      date: null, excludeFromLifetime: false, tournamentWinner: null }
  ];
}

function emptyRoomState() {
  return { config: defaultConfig(), rounds: defaultRounds(), archivedSeasons: [], year: String(new Date().getFullYear()), unlocked: false };
}

// Ensures older cached/remote rounds have the newer fields this version
// introduced (date, excludeFromLifetime, tournamentWinner, oneOneOneOrder,
// wolfOrder, and "No Game" support), so nothing crashes reading
// pre-upgrade data. Takes the player-id list explicitly rather than
// reading global state, since this runs during room-load before `state`
// necessarily reflects the data being migrated (see applyRemoteRoomRow,
// which migrates an incoming row before assigning it into state/liveRoomState).
function migrateRoundsForIds(rounds, ids) {
  if (!rounds) return rounds;
  const n = (ids && ids.length) || 3;
  rounds.forEach(r => {
    if (r.date === undefined) r.date = null;
    if (r.excludeFromLifetime === undefined) r.excludeFromLifetime = false;
    if (r.tournamentWinner === undefined) r.tournamentWinner = null;
    if (r.type === '111' && (!r.oneOneOneOrder || r.oneOneOneOrder.length !== n)) r.oneOneOneOrder = ids;
    if (r.type === '111' && r.rotateEvery == null) r.rotateEvery = 6;
    if (r.type === 'wolf' && (!r.wolfOrder || r.wolfOrder.length !== n)) r.wolfOrder = ids;
  });
  return rounds;
}
// Convenience wrapper for the common case of migrating against currently-
// loaded global state (used by loadRoomCache, which loads into `state`
// directly and has no separate "incoming config" to migrate against).
function migrateRounds(rounds) { return migrateRoundsForIds(rounds, playerIds()); }
// Wrapper for migrating a row/snapshot's rounds against ITS OWN config's
// player list, not global state — required in applyRemoteRoomRow since the
// incoming row hasn't been assigned into state/liveRoomState yet.
function migrateRoundsForConfig(rounds, config) {
  const ids = (config && config.players) ? config.players.map(p => p.id) : ['p1', 'p2', 'p3'];
  return migrateRoundsForIds(rounds, ids);
}

// Backfills config fields added after a room was first created: player
// handicaps, the skins point-value block, and the useHandicaps toggle.
// Safe to call repeatedly — every check is a no-op once already present.
function migrateConfig(config) {
  if (!config) return config;
  if (config.useHandicaps == null) config.useHandicaps = false;
  if (!config.skins) config.skins = { pointValue: 1 };
  if (config.players) config.players.forEach(p => { if (p.handicap == null) p.handicap = 0; });
  if (config.courses) config.courses.forEach(c => {
    if (!c.holeCount) c.holeCount = c.holes ? c.holes.length : 18;
    if (c.courseId === undefined) c.courseId = null;
    if (!c.holeSet) c.holeSet = c.holeCount === 18 ? '18' : 'front9';
  });
  return config;
}

function loadRoomCache(roomId) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + roomId);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.config && parsed.rounds) {
        if (!parsed.archivedSeasons) parsed.archivedSeasons = [];
        if (!parsed.year) parsed.year = String(new Date().getFullYear());
        migrateConfig(parsed.config);
        migrateRounds(parsed.rounds);
        (parsed.archivedSeasons || []).forEach(s => {
          if (s.config) migrateConfig(s.config);
          migrateRounds(s.rounds);
        });
        parsed.unlocked = false;
        return parsed;
      }
    }
  } catch (e) { console.warn('Could not load room cache', e); }
  return null;
}

let state = emptyRoomState();
let auth = { client: null, session: null, rooms: [], activeRoomId: null, ready: false };

// Shared golf course database — global across every room/user (not part of
// room state), loaded once after auth and kept live via a realtime
// subscription. Each entry: { id, name, holes: [{number, par, index} x18] }.
let courseLibrary = [];
let courseLibraryLoaded = false;
let courseLibraryChannel = null;

function saveState() {
  if (!auth.activeRoomId) return;
  if (!isViewingLive()) {
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
function isGodOverrideRoom() { return !!auth.godOverrideRoomId && auth.activeRoomId === auth.godOverrideRoomId; }
function activeMembership() {
  if (auth.isSuperAdmin && isGodOverrideRoom()) {
    return { id: auth.activeRoomId, player_id: null, role: 'admin' };
  }
  return auth.rooms.find(r => r.id === auth.activeRoomId) || null;
}
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
function playerHandicap(id) {
  const p = state.config.players.find(p => p.id === id);
  return p && p.handicap != null ? Number(p.handicap) : 0;
}
function initial(id) { return (playerName(id)[0] || '?').toUpperCase(); }
function courseFor(roundIdx) {
  const c = state.config.courses[roundIdx - 1];
  if (c && !c.holeCount) c.holeCount = c.holes ? c.holes.length : 18;
  return c;
}
function holeConfig(roundIdx, n) {
  const c = courseFor(roundIdx);
  return (c.holes.find(h => h.number === n)) || { number: n, par: 4, index: n };
}
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ---------------------------------------------------------------
   HANDICAP / NET SCORING
   Standard stroke allocation: a player gets 1 extra stroke on every hole
   whose stroke index is <= their (rounded) handicap; if the handicap
   exceeds the hole count, a 2nd (3rd, ...) stroke is layered on starting
   from index 1 again. Decimal handicaps (e.g. 12.4) round to the nearest
   whole stroke for allocation — the decimal itself is just kept for the
   player's own reference/Course Handicap tracking.
---------------------------------------------------------------- */
function useHandicaps() { return !!state.config.useHandicaps; }

function strokesReceivedOnHole(handicap, holeIndex, holeCount) {
  if (!handicap || handicap <= 0) return 0;
  const hcp = Math.round(handicap);
  const n = holeCount || 18;
  const base = Math.floor(hcp / n);
  const remainder = hcp - base * n;
  let strokes = base;
  if (holeIndex <= remainder) strokes += 1;
  return strokes;
}

// Net strokes for one player on one hole. Returns null if gross is null
// (hole not yet entered) so callers can still treat null as "not entered".
function netStrokes(gross, handicap, holeIndex, holeCount) {
  if (gross == null || gross === '') return null;
  return gross - strokesReceivedOnHole(handicap, holeIndex, holeCount);
}

// The value every scoring engine should actually compare for a hole: net
// strokes when handicaps are on, gross otherwise (so toggling the setting
// off exactly reproduces old, pre-handicap behavior with zero code changes
// downstream). ids is the roster to compute for; hd is the hole's raw
// score object; holeIndex/holeCount come from the round's course.
function comparisonScores(hd, ids, holeIndex, holeCount) {
  const out = {};
  ids.forEach(id => {
    out[id] = useHandicaps() ? netStrokes(hd[id], playerHandicap(id), holeIndex, holeCount) : hd[id];
  });
  return out;
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

function matchPlayHolePoints(holeData, ids, holeIndex, holeCount) {
  if (!allEntered(holeData, ids)) return null;
  const cmp = comparisonScores(holeData, ids, holeIndex, holeCount);
  const vals = ids.map(id => cmp[id]);
  const min = Math.min(...vals);
  const winners = ids.filter(id => cmp[id] === min);
  const result = {};
  ids.forEach(id => result[id] = 0);
  if (winners.length === 1) result[winners[0]] = 1;
  else if (winners.length === 2) winners.forEach(id => result[id] = 0.5);
  return result;
}

// Wolf tee order for a hole, generalized to work for either 3 or 4
// players (previously hardcoded to exactly 3). Front-nine (or first-half,
// for 9-hole rounds) walks the base order; back-nine walks it reversed.
// Returns the wolf for this hole plus every other player in seat order
// (so callers can build "team with X" options without assuming there are
// exactly 2 other players, as the old first/second scheme did).
function getWolfOrderForHole(round, holeNumber, holeCountForRound) {
  const ids = playerIds();
  const n = ids.length;
  const base = (round.wolfOrder && round.wolfOrder.length === n) ? round.wolfOrder : ids;
  const half = Math.ceil((holeCountForRound || 18) / 2);
  let order, idx;
  if (holeNumber <= half) { order = base; idx = (holeNumber - 1) % n; }
  else { order = [...base].reverse(); idx = (holeNumber - half - 1) % n; }
  const wolfPlayer = order[idx];
  const others = order.filter((_, i) => i !== idx);
  return { wolf: wolfPlayer, others };
}

// Divisors of holeCountForRound that make sense as a 6-6-6 rotation
// frequency — only values that split the round's holes into even groups
// are offered (e.g. 18 holes -> 1, 2, 3, 6; 9 holes -> 1, 3, 9 is silly so
// capped below 9). "6-6-6" is just the traditional name for the 18-hole/
// rotate-every-6 case; other frequencies are still valid variants.
function oneOneOneRotationOptions(holeCountForRound) {
  const n = holeCountForRound || 18;
  const candidates = [1, 2, 3, 6, 9];
  return candidates.filter(c => c < n && n % c === 0);
}

// Same rotation *pattern* as Wolf (settable base order, front nine walks
// it, back nine walks the reversed order) but instead of rotating every
// hole, the solo player only changes every `round.rotateEvery` holes — the
// hole-6-6-6 style. holeNumber and rotateEvery are both 1-based; a group
// of `rotateEvery` consecutive holes shares the same solo player, exactly
// like the classic "6-6-6" format (rotate at holes 7 and 13 on an 18-hole
// round, by default).
// Rotates the solo player in even blocks across the WHOLE round — holes
// 1-6, 7-12, 13-18 for the classic 18-hole/rotate-every-6 case — rather
// than Wolf's front-nine/reversed-back-nine pattern, which doesn't match
// how "6-6-6" is actually played (each of the 3 blocks plays a genuinely
// different solo player straight through, with no reversal).
function getOneOneOneSoloForHole(round, holeNumber, holeCountForRound) {
  const ids = playerIds();
  const n = ids.length;
  const base = (round.oneOneOneOrder && round.oneOneOneOrder.length === n) ? round.oneOneOneOrder : ids;
  const holeCount = holeCountForRound || 18;
  const validRotations = oneOneOneRotationOptions(holeCount);
  const rotateEvery = (round.rotateEvery && validRotations.includes(round.rotateEvery)) ? round.rotateEvery : (validRotations[validRotations.length - 1] || 1);
  const groupIdx = Math.floor((holeNumber - 1) / rotateEvery) % n;
  return base[groupIdx];
}

// Wolf now supports exactly 3 or 4 players. The wolf either goes it alone
// (optionally "blind" — declared before any tee shots, for a point
// multiplier) or teams up with exactly one of the other players, chosen by
// player id directly (holeData.wolf.partner is 'lone' | 'blind' | a player
// id) — this replaces the old 3-player-only 'first'/'second' scheme, which
// assumed there were always exactly 2 non-wolf players to choose between.
function wolfHolePoints(holeData, holeNumber, round, holeIndex, holeCountForRound) {
  const ids = playerIds();
  if (!allEntered(holeData, ids)) return null;
  const cfg = state.config.wolf;
  const cmp = comparisonScores(holeData, ids, holeIndex, holeCountForRound);
  const { wolf: wolfPlayer, others } = getWolfOrderForHole(round, holeNumber, holeCountForRound);
  const decision = (holeData.wolf && holeData.wolf.partner) || 'lone';
  const isBlind = decision === 'blind';
  const isLoneStyle = decision === 'lone' || decision === 'blind';
  let teamIds, oppIds, partnerId = null;
  if (isLoneStyle) { teamIds = [wolfPlayer]; oppIds = others; }
  else {
    partnerId = others.includes(decision) ? decision : others[0];
    teamIds = [wolfPlayer, partnerId];
    oppIds = others.filter(id => id !== partnerId);
  }
  const teamBest = Math.min(...teamIds.map(id => cmp[id]));
  const oppBest = Math.min(...oppIds.map(id => cmp[id]));
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

function oneOneOneHolePoints(holeData, holeNumber, round, holeIndex, holeCountForRound) {
  const ids = playerIds();
  if (!allEntered(holeData, ids)) return null;
  const cfg = state.config.oneOneOne;
  const cmp = comparisonScores(holeData, ids, holeIndex, holeCountForRound);
  const soloPlayer = getOneOneOneSoloForHole(round, holeNumber, holeCountForRound);
  const teamIds = ids.filter(id => id !== soloPlayer);
  const soloScore = cmp[soloPlayer];
  const teamBest = Math.min(...teamIds.map(id => cmp[id]));
  const result = {}; ids.forEach(id => result[id] = 0);
  let outcome = 'tie';
  if (soloScore < teamBest) { outcome = 'solo-win'; result[soloPlayer] = cfg.soloWin; }
  else if (teamBest < soloScore) { outcome = 'team-win'; teamIds.forEach(id => result[id] = cfg.teamWin); }
  return { points: result, soloPlayer, teamIds, outcome };
}

// Skins: the lowest (net, if handicaps on) score on a hole wins every skin
// riding on it — that's 1 skin, plus any carried over from prior tied
// holes. A tie for lowest carries all riding skins forward to the next
// hole. Sequential by nature (carryIn/carryOut), so computeRound() must
// call this hole-by-hole in order rather than independently per hole.
function skinsHolePoints(holeData, ids, holeIndex, holeCountForRound, carryIn) {
  if (!allEntered(holeData, ids)) return { points: null, winner: null, skinsWon: 0, carryOut: carryIn, tied: false, entered: false };
  const cmp = comparisonScores(holeData, ids, holeIndex, holeCountForRound);
  const vals = ids.map(id => cmp[id]);
  const min = Math.min(...vals);
  const winners = ids.filter(id => cmp[id] === min);
  const result = {}; ids.forEach(id => result[id] = 0);
  const pointValue = (state.config.skins && state.config.skins.pointValue) || 1;
  if (winners.length === 1) {
    const skinsWon = carryIn + 1;
    result[winners[0]] = skinsWon * pointValue;
    return { points: result, winner: winners[0], skinsWon, carryOut: 0, tied: false, entered: true };
  }
  return { points: result, winner: null, skinsWon: 0, carryOut: carryIn + 1, tied: true, entered: true };
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
  const holeCount = courseFor(roundIdx).holeCount || 18;
  const isScramble = round.type === 'scramble';
  const handicapsOn = useHandicaps();
  let skinsCarry = 0; // running carryover — only meaningful for round.type === 'skins', walked sequentially below

  for (let n = 1; n <= holeCount; n++) {
    const hd = round.holes[n];
    const hc = holeConfig(roundIdx, n);
    const par = hc.par;

    // Scramble is just one shared team score per hole — it never
    // contributes to Stableford, game points, or CTP/Longest Drive, so it's
    // handled as a self-contained branch rather than threading through the
    // per-player math below.
    if (isScramble) {
      const teamScore = hd.team;
      if (teamScore != null) holesComplete++;
      perHole.push({ number: n, par, index: hc.index, scores: hd, net: {}, strokesGiven: {}, stableford: {}, gamePoints: null, meta: null, bestBall: null, teamScore });
      continue;
    }

    // Net strokes / strokes-given per player on this hole (mirrors gross
    // when handicaps are off) — used for the scorecard's Net Score row and
    // small stroke-dot indicators, independent of which game is running.
    const net = {};
    const strokesGiven = {};
    ids.forEach(id => {
      strokesGiven[id] = handicapsOn ? strokesReceivedOnHole(playerHandicap(id), hc.index, holeCount) : 0;
      net[id] = handicapsOn ? netStrokes(hd[id], playerHandicap(id), hc.index, holeCount) : hd[id];
    });

    const stableford = {};
    ids.forEach(id => {
      const scoreForStableford = handicapsOn ? net[id] : hd[id];
      const pts = stablefordForScore(scoreForStableford, par);
      stableford[id] = pts;
      if (pts != null) stablefordTotals[id] += pts;
      if (hd[id] != null) strokeTotals[id] += hd[id];
    });

    let gamePoints = null, meta = null;
    if (round.type === 'matchplay3') {
      gamePoints = matchPlayHolePoints(hd, ids, hc.index, holeCount);
    } else if (round.type === 'wolf') {
      const w = wolfHolePoints(hd, n, round, hc.index, holeCount);
      if (w) { gamePoints = w.points; meta = w; }
    } else if (round.type === '111') {
      const o = oneOneOneHolePoints(hd, n, round, hc.index, holeCount);
      if (o) { gamePoints = o.points; meta = o; }
    } else if (round.type === 'skins') {
      const s = skinsHolePoints(hd, ids, hc.index, holeCount, skinsCarry);
      if (s.entered) {
        gamePoints = s.points;
        meta = { winner: s.winner, skinsWon: s.skinsWon, carryIn: skinsCarry, carryOut: s.carryOut, tied: s.tied };
        skinsCarry = s.carryOut;
      }
    }
    // 'none' (No Game) rounds never produce gamePoints — strokes/Stableford
    // still accrue above, but there's no game-points/winner logic.
    if (gamePoints) {
      ids.forEach(id => rawGameTotals[id] += gamePoints[id]);
    }
    if (round.type === 'none' ? allEntered(hd, ids) : gamePoints) {
      holesComplete++;
    }

    let bestBall = null;
    if (round.type === 'matchplay3' && allEntered(hd, ids)) {
      bestBall = Math.min(...ids.map(id => hd[id]));
      bestBallTotal += bestBall;
      bestBallHolesCounted++;
    }

    perHole.push({ number: n, par, index: hc.index, scores: hd, net, strokesGiven, stableford, gamePoints, meta, bestBall });
  }

  const dailyAwards = (!isScramble && holesComplete > 0) ? computeDailyAwards(rawGameTotals) : Object.fromEntries(ids.map(id => [id, 0]));
  const finalized = holesComplete === holeCount;

  return { perHole, rawGameTotals, stablefordTotals, strokeTotals, dailyAwards, bestBallTotal, bestBallHolesCounted, holesComplete, finalized, isScramble };
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

// All rounds finalized (every hole for every round complete) — used for the
// Home "Winner" banner and for auto-computing the season's tournament winner.
function allRoundsFinalized(computed) {
  return computed.rounds.every(rc => rc.finalized);
}

function weekendRanking(computed) {
  const ids = playerIds();
  return ids.map(id => ({ id, total: computed.totalsPerPlayer[id].safeTotal })).sort((a, b) => b.total - a.total);
}

/* ---------------------------------------------------------------
   STATS ENGINE
---------------------------------------------------------------- */
function computeStats(computed, rounds) {
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
    skinsWon: 0, skinsPointsWon: 0,
    ctpWins: 0, ldWins: 0,
    tournamentWins: 0, tournamentRunnerUps: 0,
    bestRoundScore: null, bestRoundLabel: '',
    mostStablefordInRound: null, mostStablefordLabel: ''
  });

  rounds.forEach((round, ri) => {
    if (round.excludeFromLifetime) return;
    const rc = computed.rounds[ri];
    // "Best round score" and "most Stableford in a round" only make sense
    // comparing like-for-like — a 9-hole round can't fairly beat/lose to an
    // 18-hole one, and Scramble has no individual strokes at all, so those
    // rounds are skipped for these two stats only.
    const fullRound = (courseFor(ri + 1).holeCount || 18) === 18 && round.type !== 'scramble';

    if (round.ctpWinner && stats[round.ctpWinner]) stats[round.ctpWinner].ctpWins++;
    if (round.ldWinner && stats[round.ldWinner]) stats[round.ldWinner].ldWins++;

    if (fullRound) {
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
    }

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

      if (round.type === 'skins' && h.meta && h.meta.winner) {
        stats[h.meta.winner].skinsWon++;
        stats[h.meta.winner].skinsPointsWon += (h.meta.skinsWon || 1) * ((state.config.skins && state.config.skins.pointValue) || 1);
      }
    });
  });

  rounds.forEach((round, ri) => {
    if (round.excludeFromLifetime) return;
    const rc = computed.rounds[ri];
    const maxAward = Math.max(...ids.map(id => rc.dailyAwards[id] || 0));
    if (maxAward > 0) ids.forEach(id => { if ((rc.dailyAwards[id] || 0) === maxAward) stats[id].dailyWins++; });
  });

  // Season-level tournament win/runner-up: prefer an admin-set winner if
  // present, else fall back to computed weekend ranking once all rounds
  // (that aren't excluded) are finalized.
  const relevantRounds = rounds.map((r, i) => ({ r, rc: computed.rounds[i] }));
  const allDone = relevantRounds.every(x => x.r.excludeFromLifetime || x.rc.finalized);
  if (allDone) {
    const explicitWinner = rounds.find(r => r.tournamentWinner)?.tournamentWinner;
    let winnerId = explicitWinner || null;
    let ranked = weekendRanking(computed);
    if (!winnerId && ranked.length) winnerId = ranked[0].id;
    if (winnerId && stats[winnerId]) stats[winnerId].tournamentWins++;
    const runnerUp = ranked.find(r => r.id !== winnerId);
    if (runnerUp && stats[runnerUp.id]) stats[runnerUp.id].tournamentRunnerUps++;
  }

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

  if (allRoundsFinalized(computed)) {
    const ranked = weekendRanking(computed);
    const winnerId = ranked[0] ? ranked[0].id : null;
    const html = `<div class="status-widget">
      <div class="status-row done winner-row">
        <div class="status-name" style="width:auto; flex:1;">
          🏆 Winner
          <span class="status-course">${winnerId ? escapeHtml(playerName(winnerId)) : ''}</span>
        </div>
        <div class="status-frac"><span class="status-check">✓</span></div>
      </div>
    </div>`;
    document.getElementById('roundStatusWidget').innerHTML = html;
    return;
  }

  let currentIdx = computed.rounds.findIndex(rc => !rc.finalized);
  if (currentIdx === -1) currentIdx = state.rounds.length - 1;

  const round = state.rounds[currentIdx];
  const rc = computed.rounds[currentIdx];
  const course = courseFor(currentIdx + 1);
  const holeCount = course.holeCount || 18;
  const isDone = rc.finalized;
  const pct = Math.round((rc.holesComplete / holeCount) * 100);

  const html = `<div class="status-widget">
    <div class="status-row ${isDone ? '' : 'active-round'} ${isDone ? 'done' : ''}">
      <div class="status-name">${round.label}<span class="status-course">${escapeHtml(course.name)}</span></div>
      <div class="status-track"><div class="status-fill" style="width:${pct}%"></div></div>
      <div class="status-frac">${isDone ? '<span class="status-check">✓</span> Done' : `${rc.holesComplete}/${holeCount}`}</div>
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

function assembleRow(labelHtml, cellsN, holeCount, outHtml, inHtml, totalHtml, rowClass, extraAttrs) {
  let html = `<tr class="${rowClass || ''}" ${extraAttrs || ''}>${labelHtml}`;
  if (holeCount === 18) {
    for (let i = 0; i < 9; i++) html += cellsN[i];
    html += outHtml;
    for (let i = 9; i < 18; i++) html += cellsN[i];
    html += inHtml + totalHtml;
  } else {
    for (let i = 0; i < holeCount; i++) html += cellsN[i];
    html += totalHtml;
  }
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

function wolfCompactCell(round, n, holeCountForRound) {
  const decision = (round.holes[n].wolf && round.holes[n].wolf.partner) || 'lone';
  const { wolf, others } = getWolfOrderForHole(round, n, holeCountForRound);
  const wIn = initial(wolf);
  if (decision === 'blind') return `<span class="indicator-blind">${wIn}⚡</span>`;
  if (decision === 'lone') return wIn;
  // decision holds the chosen partner's player id directly when it's
  // neither 'lone' nor 'blind' — works for both 3- and 4-player Wolf.
  const partnerId = others.includes(decision) ? decision : others[0];
  return `${wIn}+${initial(partnerId)}`;
}

function renderRoundTabs() {
  const el = document.getElementById('roundSegmented');
  if (!el) return;
  // If there's only a single round configured, the tab strip has nothing
  // to switch between — hide it rather than show a lone, useless button.
  if (state.rounds.length <= 1) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = state.rounds.map((r, i) => `<button data-round="${i + 1}" class="${activeRoundTab === i + 1 ? 'active' : ''}">${r.label}</button>`).join('');
}
function renderModalRoundTabs() {
  const el = document.getElementById('modalRoundSegmented');
  if (!el) return;
  el.innerHTML = state.rounds.map((r, i) => `<button data-round="${i + 1}" class="${modalRound === i + 1 ? 'active' : ''}">${r.label}</button>`).join('');
}

function renderRoundsView() {
  renderRoundTabs();
  if (!appReady()) { document.getElementById('roundContent').innerHTML = readyGateHtml(); return; }

  // Year indicator, top-right, across from the "Scorecard" heading — only
  // meaningful once there's more than one year to distinguish between
  // (i.e. at least one archived season exists alongside the live year).
  const sectionTitle = document.querySelector('#view-rounds .section-title');
  if (sectionTitle) {
    let yearBadge = sectionTitle.querySelector('.year-indicator');
    const hasMultipleYears = ((liveRoomState || state).archivedSeasons || []).length > 0;
    if (appReady() && hasMultipleYears) {
      if (!yearBadge) {
        yearBadge = document.createElement('span');
        yearBadge.className = 'year-indicator';
        sectionTitle.appendChild(yearBadge);
      }
      yearBadge.textContent = `${state.year}` + (isViewingLive() ? '' : ' (archived)');
    } else if (yearBadge) {
      yearBadge.remove();
    }
  }

  const computed = computeAll();
  const round = state.rounds[activeRoundTab - 1];
  const rc = computed.rounds[activeRoundTab - 1];
  const ids = playerIds();
  const course = courseFor(activeRoundTab);
  const holeCount = course.holeCount || 18;
  const editable = canEditAnyScore();
  const isScramble = round.type === 'scramble';

  const holesArr = []; for (let n = 1; n <= holeCount; n++) holesArr.push(n);

  let html = `<div class="scorecard-scroll"><table class="scorecard"><thead>`;

  const totalCols = holeCount === 18 ? 22 : (holeCount + 2);
  const leftSpan = Math.ceil(totalCols / 2), rightSpan = totalCols - leftSpan;
  const titleRight = round.gameName + (round.date ? ` · ${fmtDate(round.date)}` : '');
  html += `<tr class="card-title-row"><td colspan="${leftSpan}" class="title-left">${escapeHtml(course.name)}</td><td colspan="${rightSpan}" class="title-right">${escapeHtml(titleRight)}</td></tr>`;

  const headerCells = holesArr.map(n => `<th class="${holeColClasses(course, n)}">${n}</th>`);
  html += assembleRow('<th>Hole</th>', headerCells, holeCount, '<th class="out-col">Out</th>', '<th class="in-col">In</th>', '<th class="total-col">Total</th>', 'hole-header');
  html += `</thead><tbody>`;

  let parOut = 0, parIn = 0;
  const parCells = holesArr.map(n => { const par = holeConfig(activeRoundTab, n).par; if (n <= 9) parOut += par; else parIn += par; return `<td class="${holeColClasses(course, n)}">${par}</td>`; });
  html += assembleRow('<td>Par</td>', parCells, holeCount, `<td class="out-col">${parOut}</td>`, `<td class="in-col">${parIn}</td>`, `<td class="total-col">${parOut + parIn}</td>`, 'par-row');

  const idxCells = holesArr.map(n => `<td class="${holeColClasses(course, n)}">${holeConfig(activeRoundTab, n).index}</td>`);
  html += assembleRow('<td>Index</td>', idxCells, holeCount, '<td class="out-col"></td>', '<td class="in-col"></td>', '<td class="total-col"></td>', 'index-row');

  if (isScramble) {
    // Scramble: one shared team score per hole, no per-player breakdown at all.
    let teamOut = 0, teamIn = 0;
    const teamCells = rc.perHole.map(h => {
      const v = h.teamScore;
      if (v != null) { if (h.number <= 9) teamOut += v; else teamIn += v; }
      const cls = scoreCategoryClass(v, h.par);
      return `<td class="score-cell ${cls} ${holeColClasses(course, h.number)}">${v != null ? v : '–'}</td>`;
    });
    html += assembleRow('<td>Team Score</td>', teamCells, holeCount,
      `<td class="out-col">${teamOut || ''}</td>`, `<td class="in-col">${teamIn || ''}</td>`, `<td class="total-col">${(teamOut + teamIn) || ''}</td>`,
      'score-row');
  } else {
    ids.forEach(id => {
      const collapsed = !!collapsedPlayers[id];
      let strokeOut = 0, strokeIn = 0;
      const scoreCells = rc.perHole.map(h => {
        const v = h.scores[id];
        if (v != null) { if (h.number <= 9) strokeOut += v; else strokeIn += v; }
        const cls = scoreCategoryClass(v, h.par);
        const given = useHandicaps() ? (h.strokesGiven[id] || 0) : 0;
        const dots = given > 0 ? '<span class="net-dot"></span>'.repeat(given) : '';
        return `<td class="score-cell ${cls} ${holeColClasses(course, h.number)}">${v != null ? v : '–'}${dots}</td>`;
      });
      html += assembleRow(
        `<td>${playerName(id)} <span class="toggle-caret">▾</span></td>`,
        scoreCells, holeCount,
        `<td class="out-col">${strokeOut || ''}</td>`, `<td class="in-col">${strokeIn || ''}</td>`, `<td class="total-col">${(strokeOut + strokeIn) || ''}</td>`,
        `score-row player-toggle-row ${collapsed ? 'collapsed' : ''}`,
        `data-toggle="${id}"`
      );

      if (useHandicaps()) {
        const netOutIn = sumOutInTotal(rc.perHole, h => h.net[id]);
        const netCells = rc.perHole.map(h => { const v = h.net[id]; return `<td class="${holeColClasses(course, h.number)}">${v != null ? v : ''}</td>`; });
        html += assembleRow('<td>Net Score</td>', netCells, holeCount,
          `<td class="out-col">${fmtOrBlank(netOutIn.out)}</td>`, `<td class="in-col">${fmtOrBlank(netOutIn.inn)}</td>`, `<td class="total-col">${fmtOrBlank(netOutIn.total)}</td>`,
          `subrow ${collapsed ? 'hidden-row' : ''}`);
      }

      if (round.type !== 'none') {
        const gpOutIn = sumOutInTotal(rc.perHole, h => h.gamePoints ? h.gamePoints[id] : null);
        const gpCells = rc.perHole.map(h => { const v = h.gamePoints ? h.gamePoints[id] : null; return `<td class="${holeColClasses(course, h.number)}">${fmtOrBlank(v)}</td>`; });
        html += assembleRow('<td>Game Points</td>', gpCells, holeCount,
          `<td class="out-col">${fmtOrBlank(gpOutIn.out)}</td>`, `<td class="in-col">${fmtOrBlank(gpOutIn.inn)}</td>`, `<td class="total-col">${fmtOrBlank(gpOutIn.total)}</td>`,
          `subrow ${collapsed ? 'hidden-row' : ''}`);
      }

      const sfOutIn = sumOutInTotal(rc.perHole, h => h.stableford[id]);
      const sfCells = rc.perHole.map(h => { const v = h.stableford[id]; return `<td class="${holeColClasses(course, h.number)}">${fmtOrBlank(v)}</td>`; });
      html += assembleRow('<td>Stableford Points</td>', sfCells, holeCount,
        `<td class="out-col">${fmtOrBlank(sfOutIn.out)}</td>`, `<td class="in-col">${fmtOrBlank(sfOutIn.inn)}</td>`, `<td class="total-col">${fmtOrBlank(sfOutIn.total)}</td>`,
        `subrow ${collapsed ? 'hidden-row' : ''}`);
    });

    if (round.type === 'matchplay3') {
      const bbOutIn = sumOutInTotal(rc.perHole, h => h.bestBall);
      const bbCells = rc.perHole.map(h => `<td class="${holeColClasses(course, h.number)}">${h.bestBall != null ? h.bestBall : ''}</td>`);
      html += assembleRow(`<td>Best Ball (goal ${state.config.bestBallGoal})</td>`, bbCells, holeCount,
        `<td class="out-col">${bbOutIn.out || ''}</td>`, `<td class="in-col">${bbOutIn.inn || ''}</td>`, `<td class="total-col">${bbOutIn.total || ''}</td>`,
        'bestball-row');
    }

    if (round.type === 'wolf') {
      const wCells = rc.perHole.map(h => `<td class="${holeColClasses(course, h.number)}">${wolfCompactCell(round, h.number, holeCount)}</td>`);
      html += assembleRow('<td>🐺 Wolf</td>', wCells, holeCount, '<td class="out-col"></td>', '<td class="in-col"></td>', '<td class="total-col"></td>', 'indicator-row');
    }

    if (round.type === '111') {
      const mCells = rc.perHole.map(h => `<td class="${holeColClasses(course, h.number)}">${initial(getOneOneOneSoloForHole(round, h.number, holeCount))}</td>`);
      html += assembleRow('<td>Solo</td>', mCells, holeCount, '<td class="out-col"></td>', '<td class="in-col"></td>', '<td class="total-col"></td>', 'indicator-row');
    }

    if (round.type === 'skins') {
      const pointValue = (state.config.skins && state.config.skins.pointValue) || 1;
      const sCells = rc.perHole.map(h => {
        if (!h.meta) return `<td class="${holeColClasses(course, h.number)}"></td>`;
        if (h.meta.winner) return `<td class="${holeColClasses(course, h.number)}"><span class="skin-won">${initial(h.meta.winner)}${h.meta.skinsWon > 1 ? ` ×${h.meta.skinsWon}` : ''}</span></td>`;
        if (h.meta.tied) return `<td class="${holeColClasses(course, h.number)}"><span class="skin-carry">carry →</span></td>`;
        return `<td class="${holeColClasses(course, h.number)}"></td>`;
      });
      html += assembleRow(`<td>💰 Skins (${pointValue} pt ea)</td>`, sCells, holeCount, '<td class="out-col"></td>', '<td class="in-col"></td>', '<td class="total-col"></td>', 'indicator-row');
    }
  }

  html += `</tbody></table></div>`;

  if (isScramble) {
    html += `<div class="card"><p class="helper-text" style="margin:0;">Scramble is just for fun — it doesn't count toward Stableford, game points, or the weekend leaderboard, and has no Closest to the Pin or Longest Drive.</p></div>`;
  } else {
    const ctpOpts = `<option value="">— Select —</option>` + ids.map(id => `<option value="${id}" ${round.ctpWinner === id ? 'selected' : ''}>${playerName(id)}</option>`).join('');
    const ldOpts = `<option value="">— Select —</option>` + ids.map(id => `<option value="${id}" ${round.ldWinner === id ? 'selected' : ''}>${playerName(id)}</option>`).join('');
    html += `<div class="card ctpld-row">
      <div class="field-row">
        <div class="field"><label>Closest to the Pin Winner (Hole ${course.ctpHole})</label><select id="ctpWinnerSelect" ${editable ? '' : 'disabled'}>${ctpOpts}</select></div>
        <div class="field"><label>Longest Drive Winner (Hole ${course.ldHole})</label><select id="ldWinnerSelect" ${editable ? '' : 'disabled'}>${ldOpts}</select></div>
      </div>
      ${editable ? '' : '<p class="helper-text">Log in from Settings to set the CTP/Drive winners.</p>'}
    </div>`;
  }

  document.getElementById('roundContent').innerHTML = html;

  document.querySelectorAll('.player-toggle-row').forEach(row => {
    row.querySelector('td:first-child').addEventListener('click', () => {
      const id = row.getAttribute('data-toggle');
      if (id) { collapsedPlayers[id] = !collapsedPlayers[id]; renderRoundsView(); }
    });
  });
  const ctpSel = document.getElementById('ctpWinnerSelect');
  const ldSel = document.getElementById('ldWinnerSelect');
  if (ctpSel) ctpSel.addEventListener('change', () => { round.ctpWinner = ctpSel.value || null; saveState(); renderLeaderboard(); renderStats(); });
  if (ldSel) ldSel.addEventListener('change', () => { round.ldWinner = ldSel.value || null; saveState(); renderLeaderboard(); renderStats(); });
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

// One-line "Game" row indicator for a single hole — mirrors the compact
// in-app scorecard indicators (Wolf/1-1-1/Skins) so the CSV's per-hole
// "Game" row reads the same as what's on screen. Match Play has no useful
// per-hole indicator beyond the points already implied by Stableford/Total,
// so it's left blank; "No Game" and Scramble never reach this (Scramble is
// handled entirely separately, and 'none' rounds simply produce blanks).
function gameIndicatorForHole(round, h, holeCountForRound) {
  if (round.type === 'wolf' && h.meta) {
    const m = h.meta;
    const base = m.lone ? `${initial(m.wolfPlayer)}${m.blind ? '⚡' : ''}` : `${initial(m.wolfPlayer)}+${initial(m.partnerId)}`;
    return base;
  }
  if (round.type === '111') {
    return initial(getOneOneOneSoloForHole(round, h.number, holeCountForRound));
  }
  if (round.type === 'skins' && h.meta) {
    if (h.meta.winner) return `${initial(h.meta.winner)}${h.meta.skinsWon > 1 ? ` x${h.meta.skinsWon}` : ''}`;
    if (h.meta.tied) return 'carry';
  }
  return '';
}

// Builds the row block(s) for one round, formatted to match the club's
// established export template (a header/course/game line, a Hole/Par/Index
// trio, one row per player, a Game indicator row, then a blank separator
// row) rather than the old one-row-per-hole-per-player layout.
function csvRoundBlock(round, ri, computed, config) {
  const ids = (config.players || []).map(p => p.id);
  const nameOf = (id) => { const p = config.players.find(pl => pl.id === id); return p ? p.name : id; };
  const rc = computed.rounds[ri];
  const course = courseFor(ri + 1);
  const holeCount = course.holeCount || 18;
  const rows = [];

  const ctpWinner = round.ctpWinner ? nameOf(round.ctpWinner) : '';
  const ldWinner = round.ldWinner ? nameOf(round.ldWinner) : '';
  const isScramble = round.type === 'scramble';

  // Line 1: Round label, course, date, game name, CTP/LD hole+winner.
  rows.push([
    round.label, course.name, round.date || '', round.gameName, '',
    'CTP:', isScramble ? '' : course.ctpHole, isScramble ? '' : ctpWinner, '',
    'Longest Drive:', isScramble ? '' : course.ldHole, isScramble ? '' : ldWinner, ''
  ]);

  // Line 2: Hole header row (always shows all 18 columns per the template;
  // holes beyond the round's actual hole count are simply left blank).
  const holeHeaderRow = ['Hole'];
  for (let n = 1; n <= 18; n++) holeHeaderRow.push(n <= holeCount ? n : '');
  holeHeaderRow.push('Total', 'Stableford Points', 'Daily Game Points');
  rows.push(holeHeaderRow);

  // Line 3: Par row.
  const parRow = ['Par'];
  for (let n = 1; n <= 18; n++) parRow.push(n <= holeCount ? holeConfig(ri + 1, n).par : '');
  parRow.push('');
  rows.push(parRow);

  // Line 4: Index row.
  const idxRow = ['Index'];
  for (let n = 1; n <= 18; n++) idxRow.push(n <= holeCount ? holeConfig(ri + 1, n).index : '');
  idxRow.push('');
  rows.push(idxRow);

  if (isScramble) {
    // Scramble: single shared "Team" row, no Stableford/Daily Game points.
    const teamRow = ['Team'];
    let total = 0;
    for (let n = 1; n <= 18; n++) {
      const h = rc.perHole[n - 1];
      const v = (h && n <= holeCount) ? h.teamScore : null;
      if (v != null) total += v;
      teamRow.push(v != null ? v : '');
    }
    teamRow.push(total || '', '', '');
    rows.push(teamRow);
  } else {
    ids.forEach(id => {
      const playerRow = [nameOf(id)];
      for (let n = 1; n <= 18; n++) {
        const h = rc.perHole[n - 1];
        const v = (h && n <= holeCount) ? h.scores[id] : null;
        playerRow.push(v != null ? v : '');
      }
      playerRow.push(rc.strokeTotals[id] || '', rc.stablefordTotals[id] || '', rc.dailyAwards[id] || '');
      rows.push(playerRow);
    });

    // Game indicator row — blank for "No Game" rounds (nothing to show).
    if (round.type !== 'none') {
      const gameRow = ['Game'];
      for (let n = 1; n <= 18; n++) {
        const h = rc.perHole[n - 1];
        gameRow.push((h && n <= holeCount) ? gameIndicatorForHole(round, h, holeCount) : '');
      }
      gameRow.push('');
      rows.push(gameRow);
    }
  }

  rows.push(['']);
  return rows;
}

function csvRowsForSnapshot(yearLabel, config, rounds) {
  const savedConfig = state.config, savedRounds = state.rounds;
  state.config = config; state.rounds = rounds;
  const computed = computeAll();
  const rows = [];
  state.rounds.forEach((round, ri) => { rows.push(...csvRoundBlock(round, ri, computed, config)); });
  state.config = savedConfig; state.rounds = savedRounds;
  return rows;
}

function exportRoomCSV() {
  const liveSrc = liveRoomState || state;
  const allSnapshots = [{ year: liveSrc.year, config: liveSrc.config, rounds: liveSrc.rounds }]
    .concat(sortedArchivedSeasons().map(s => ({ year: s.year, config: s.config, rounds: s.rounds })));

  let rows = [];
  allSnapshots.forEach(snap => {
    rows.push(['Year', snap.year]);
    rows = rows.concat(csvRowsForSnapshot(snap.year, snap.config, snap.rounds));
  });

  const csvText = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const room = auth.rooms.find(r => r.id === auth.activeRoomId);
  downloadCSV(`${(room ? room.room_code : 'bunker-bros')}-export.csv`, csvText);
  showToast('Exported');
}

function computeStatsForSnapshot(snapshot) {
  const savedConfig = state.config, savedRounds = state.rounds;
  state.config = snapshot.config; state.rounds = snapshot.rounds;
  const computed = computeAll();
  const stats = computeStats(computed, snapshot.rounds);
  state.config = savedConfig; state.rounds = savedRounds;
  return stats;
}

const LIFETIME_SUM_KEYS = ['birdies', 'pars', 'bogeys', 'eagles', 'albatrosses', 'dailyWins', 'mp3Wins', 'mp3Ties',
  'wolfChosenAsTeammate', 'loneWolfW', 'loneWolfL', 'loneWolfT', 'teammateW', 'teammateL', 'teammateT',
  'oneOneOneSoloWins', 'oneOneOneTeamWins', 'skinsWon', 'skinsPointsWon', 'ctpWins', 'ldWins', 'tournamentWins', 'tournamentRunnerUps'];

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
  const stats = statsMode === 'lifetime' ? computeLifetimeStats() : computeStats(computeAll(), state.rounds);
  let ids = playerIds();
  const loggedInId = myPlayerId();
  if (loggedInId && ids.includes(loggedInId)) {
    ids = [loggedInId, ...ids.filter(id => id !== loggedInId)];
  }
  const list = document.getElementById('statsList');

  const weekendLabel = isViewingLive() ? 'This Weekend' : `${state.year} Stats`;

  let html = `<div class="segmented" id="statsModeSegmented">
    <button data-mode="lifetime" class="${statsMode === 'lifetime' ? 'active' : ''}">Lifetime</button>
    <button data-mode="weekend" class="${statsMode === 'weekend' ? 'active' : ''}">${escapeHtml(weekendLabel)}</button>
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
    html += statGroup('Match Play', [
      ['Holes won', s.mp3Wins], ['Holes tied', s.mp3Ties]
    ]);
    html += statGroup('Wolf', [
      ['Chosen as teammate', s.wolfChosenAsTeammate],
      ['Lone/Blind wolf W-L-T', `${s.loneWolfW}-${s.loneWolfL}-${s.loneWolfT}`],
      ["As wolf's teammate W-L-T", `${s.teammateW}-${s.teammateL}-${s.teammateT}`]
    ]);
    html += statGroup('6-6-6', [
      ['Holes won solo', s.oneOneOneSoloWins], ['Holes won w/ teammate', s.oneOneOneTeamWins]
    ]);
    html += statGroup('Skins', [
      ['Skins won', s.skinsWon], ['Skins points won', fmtNum(s.skinsPointsWon)]
    ]);
    html += statGroup('Side Games', [
      ['Closest to the Pin wins', s.ctpWins], ['Longest Drive wins', s.ldWins]
    ]);
    html += statGroup('Tournament', [
      ['Tournaments won', s.tournamentWins], ['Runner-up finishes', s.tournamentRunnerUps]
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
  await loadCourseLibrary();
  const savedRoomId = localStorage.getItem(ACTIVE_ROOM_KEY);
  if (savedRoomId && auth.rooms.some(r => r.id === savedRoomId)) {
    await selectRoom(savedRoomId);
  } else if (auth.rooms.length === 1) {
    await selectRoom(auth.rooms[0].id);
  }
}

// Loads the shared golf course database (global, not per-room) and keeps
// it live via a realtime subscription — so if one Bro adds/edits a course
// while another has the app open, the second person's course picker
// updates without needing a manual refresh.
async function loadCourseLibrary() {
  const { data, error } = await auth.client.from('golf_courses').select('id, name, holes').order('name', { ascending: true });
  if (error) { console.warn('Could not load course library', error); return; }
  courseLibrary = data || [];
  courseLibraryLoaded = true;
  if (!courseLibraryChannel) {
    courseLibraryChannel = auth.client
      .channel('golf-courses')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'golf_courses' }, () => { loadCourseLibrary().then(() => refreshNonSettingsViews_orSettings()); })
      .subscribe();
  } else {
    refreshNonSettingsViews_orSettings();
  }
}

// Re-render whatever's currently visible after the course library changes
// remotely — the settings panel (course picker lives there) if it's open,
// otherwise just the ordinary views.
function refreshNonSettingsViews_orSettings() {
  if (settingsPanelsOpen && appReady()) { renderGameSettings(); } else { refreshNonSettingsViews(); }
}

function findCourseInLibrary(id) { return courseLibrary.find(c => c.id === id); }

// Saves (inserts or updates) a course into the shared library. Used both
// by "+ Add New Course" (insert) and "Edit This Course" (update in place —
// affects every room/round currently pointing at this course id).
async function saveCourseToLibrary(courseId, name, holes) {
  const payload = { name, holes, updated_at: new Date().toISOString() };
  if (courseId) {
    const { error } = await auth.client.from('golf_courses').update(payload).eq('id', courseId);
    if (error) { showToast('Could not save course'); return null; }
    await loadCourseLibrary();
    return courseId;
  } else {
    const { data, error } = await auth.client.from('golf_courses').insert(Object.assign({ created_by: auth.session.user.id }, payload)).select('id').maybeSingle();
    if (error) { showToast('Could not save course'); return null; }
    await loadCourseLibrary();
    return data ? data.id : null;
  }
}

async function loadMyRooms() {
  const { data: memberships, error } = await auth.client.from('room_memberships').select('room_id, player_id, role');
  if (error) { console.warn(error); auth.rooms = []; return; }
  if (!memberships || !memberships.length) { auth.rooms = []; return; }
  const uniqueRoomIds = [...new Set(memberships.map(m => m.room_id))];
  const { data: rooms, error: roomErr } = await auth.client.from('rooms').select('id, room_code, name').in('id', uniqueRoomIds);
  if (roomErr) { console.warn(roomErr); auth.rooms = []; return; }
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
  if (courseLibraryChannel) { auth.client.removeChannel(courseLibraryChannel); courseLibraryChannel = null; }
  courseLibrary = []; courseLibraryLoaded = false;
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
  await selectRoom(roomId, true);
}

async function handleMembershipChange() {
  if (!auth.activeRoomId || !auth.client) return;
  await loadMyRooms();
  if (!isGodOverrideRoom() && !auth.rooms.some(r => r.id === auth.activeRoomId)) {
    showToast('You were removed from this room');
    switchRoomView();
    return;
  }
  renderAll();
}

async function selectRoom(roomId, viaGodMode) {
  if (cloudSync.channel) { auth.client.removeChannel(cloudSync.channel); cloudSync.channel = null; }
  editorPinUnlocked = false;
  liveRoomState = null; viewingSeasonKey = null;
  if (!viaGodMode) { auth.godOverrideRoomId = null; auth.godOverrideRoomMeta = null; }
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'room_memberships', filter: `room_id=eq.${roomId}` },
      () => { handleMembershipChange(); })
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
  if (row.config) migrateConfig(row.config);
  migrateRoundsForConfig(row.rounds, row.config);
  (row.archived_seasons || []).forEach(s => {
    if (s.config) migrateConfig(s.config);
    migrateRoundsForConfig(s.rounds, s.config);
  });
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
  await loadMyRooms();
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
   SEASON NAVIGATION — Previous / Next season
---------------------------------------------------------------- */
let liveRoomState = null;
let viewingSeasonKey = null;

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
  if (idx === -1) {
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

function blankRoundsPreservingSettings() {
  return state.rounds.map((r, i) => {
    const holeCount = courseFor(i + 1).holeCount || 18;
    const fresh = { id: r.id, type: r.type, label: r.label, gameName: r.gameName, holes: {}, ctpWinner: null, ldWinner: null,
      date: null, excludeFromLifetime: false, tournamentWinner: null };
    if (r.type === 'wolf') fresh.wolfOrder = (r.wolfOrder && r.wolfOrder.length === playerIds().length) ? r.wolfOrder.slice() : playerIds();
    if (r.type === '111') fresh.oneOneOneOrder = (r.oneOneOneOrder && r.oneOneOneOrder.length === playerIds().length) ? r.oneOneOneOrder.slice() : playerIds();
    if (r.type === '111') fresh.rotateEvery = r.rotateEvery || 6;
    for (let n = 1; n <= holeCount; n++) fresh.holes[n] = buildEmptyHole(fresh);
    return fresh;
  });
}

// Admin-only: rename whichever season is currently in view — the live
// season (state.year directly) or an archived one (found via its stable
// archivedAt key, since archived seasons live in liveRoomState while a
// past season is being browsed). Blocks renaming to a name already used
// by another season in this room, live or archived, since navigation and
// backfill both key off uniqueness of the name.
function renameCurrentSeason(newName) {
  if (!newName) { showToast('Enter a season name'); return; }
  const root = liveRoomState || state;
  const liveNameTaken = !isViewingLive() && String(root.year) === newName;
  const archivedNameTaken = root.archivedSeasons.some(s =>
    String(s.year) === newName && !(!isViewingLive() && s.archivedAt === viewingSeasonKey)
  );
  if (liveNameTaken || archivedNameTaken) { showToast('That name is already used by another season'); return; }

  if (isViewingLive()) {
    state.year = newName;
  } else {
    const season = root.archivedSeasons.find(s => s.archivedAt === viewingSeasonKey);
    if (!season) return;
    season.year = newName;
    state.year = newName;
  }
  saveState();
  renderAll();
  showToast('Season renamed');
}

async function archiveAndStartNewYear(newYearLabel) {
  state.archivedSeasons.push({ year: state.year, config: JSON.parse(JSON.stringify(state.config)), rounds: JSON.parse(JSON.stringify(state.rounds)), archivedAt: Date.now() });
  const oldYear = state.year;
  state.year = newYearLabel;
  state.rounds = blankRoundsPreservingSettings();
  saveState();
  renderAll();
  showToast(`Archived ${oldYear} — welcome to ${newYearLabel}!`);
}

function addBacklogYear(label) {
  if (state.archivedSeasons.some(s => String(s.year) === String(label))) { showToast('A season with that name already exists'); return; }
  const fresh = emptyRoomState();
  fresh.config.players = JSON.parse(JSON.stringify(state.config.players));
  state.archivedSeasons.push({ year: label, config: fresh.config, rounds: fresh.rounds, archivedAt: Date.now() });
  saveState();
  renderAll();
  showToast(`Added ${label} — use the ‹ › arrows on Home to open and fill it in`);
}

// Admin-only: permanently delete an archived (non-live) season. The live
// year can never be deleted this way — only past, already-archived years.
function deleteArchivedYear(archivedAt) {
  const idx = state.archivedSeasons.findIndex(s => s.archivedAt === archivedAt);
  if (idx === -1) return;
  const label = state.archivedSeasons[idx].year;
  state.archivedSeasons.splice(idx, 1);
  if (!isViewingLive() && viewingSeasonKey === archivedAt) {
    state = liveRoomState || state; liveRoomState = null; viewingSeasonKey = null;
  }
  saveState();
  renderAll();
  showToast(`Deleted ${label}`);
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
  const showDelete = !isViewingLive() && isAdmin();
  el.innerHTML = `<div class="season-nav">
    <button class="round-nav-btn" id="seasonPrevBtn" ${canPrev ? '' : 'disabled'} aria-label="Previous season">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
    </button>
    <span class="season-nav-label">${escapeHtml(label)}${!isViewingLive() ? (isAdmin() ? ' <small>editing</small>' : ' <small>read-only</small>') : ''}</span>
    <button class="round-nav-btn" id="seasonNextBtn" ${canNext ? '' : 'disabled'} aria-label="Next season">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </button>
    ${showDelete ? `<button class="round-nav-btn" id="seasonDeleteBtn" aria-label="Delete this season" style="color:var(--rust);">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>
    </button>` : ''}
  </div>`;
  const prevBtn = document.getElementById('seasonPrevBtn');
  const nextBtn = document.getElementById('seasonNextBtn');
  const delBtn = document.getElementById('seasonDeleteBtn');
  if (prevBtn) prevBtn.addEventListener('click', () => navigateSeason(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => navigateSeason(1));
  if (delBtn) delBtn.addEventListener('click', () => {
    const typed = prompt(`This permanently deletes all "${state.year}" data. Type the season name to confirm:`);
    if (typed !== String(state.year)) { if (typed !== null) showToast('Did not match — not deleted'); return; }
    const key = viewingSeasonKey;
    deleteArchivedYear(key);
  });
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
        ? `<div id="myPlayerPickerWrap"><p class="helper-text" style="margin:0;">Loading…</p></div>`
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
  const wrap = document.getElementById('myPlayerPickerWrap');
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
// Order here is the dropdown order: "~ No Game ~" is always pinned first,
// then every other game type chronologically by when it was added to the
// app (Match Play → Wolf → 6-6-6 → Skins → Scramble). Internal type ids
// (e.g. '111') stay stable for backward compatibility even though the
// display label has changed (1-1-1 -> 6-6-6).
const GAME_TYPE_LABELS = { none: '~ No Game ~', matchplay3: 'Match Play', wolf: 'Wolf', '111': '6-6-6', skins: 'Skins', scramble: 'Scramble' };
const GAME_TYPE_ORDER = ['none', 'matchplay3', 'wolf', '111', 'skins', 'scramble'];

/* ---------------------------------------------------------------
   COURSE COMBO — searchable course picker (text input + filtered
   dropdown list), replacing a plain <select> so the shared course
   library stays usable once it has more than a handful of entries.
---------------------------------------------------------------- */

// Applies a chosen library course to a round's course config — shared by
// both the combo box's "pick a result" flow and anywhere else that needs
// to load a saved course onto a round (e.g. the course editor's Save).
function applyLibraryCourseToRound(roundIdx, lib) {
  const course = courseFor(roundIdx);
  const round = state.rounds[roundIdx - 1];
  course.courseId = lib.id;
  course.name = lib.name;
  course.holes = holesForSet(lib.holes, course.holeSet || '18');
  const newCount = holeSetToCount(course.holeSet || '18');
  resizeCourseHoles(course, newCount);
  resizeRoundHoles(round, newCount);
  saveState();
}

// Wires up one course-combo-input: typing filters courseLibrary by
// substring match (case-insensitive) and shows results in the adjacent
// .course-combo-list; picking a result loads that course onto the round
// (same confirm-and-load behavior the old <select> had). The input's
// current text is purely for searching — the round's actual courseId
// only changes when a result is clicked, so typing and then clicking
// away without picking anything leaves the round's course untouched.
function wireCourseCombo(inp) {
  const roundIdx = Number(inp.dataset.round);
  const wrap = inp.closest('.course-combo');
  const list = wrap.querySelector('.course-combo-list');
  const clearBtn = wrap.querySelector('.course-combo-clear');

  function renderResults() {
    const q = inp.value.trim().toLowerCase();
    const matches = q
      ? courseLibrary.filter(lc => lc.name.toLowerCase().includes(q)).slice(0, 30)
      : courseLibrary.slice(0, 30);
    if (!matches.length) {
      list.innerHTML = `<div class="course-combo-empty">${courseLibrary.length ? 'No matching courses' : 'No saved courses yet — use "+ Add New Course" below'}</div>`;
    } else {
      list.innerHTML = matches.map(lc => `<div class="course-combo-item" data-id="${lc.id}">${escapeHtml(lc.name)}</div>`).join('');
    }
    list.style.display = 'block';
  }

  inp.addEventListener('focus', renderResults);
  inp.addEventListener('input', () => {
    // Typing implies the person is searching, not confirming the current
    // selection — detach any stale courseId match visually by clearing
    // the stored id on the input itself (the round's real courseId only
    // changes on click, per the doc comment above).
    inp.dataset.courseId = '';
    renderResults();
  });
  inp.addEventListener('blur', () => {
    // Delay so a click on a list item registers before the list is hidden.
    setTimeout(() => {
      list.style.display = 'none';
      // If they typed something but never picked a result, and it doesn't
      // match the currently-loaded course, revert the text back to
      // whatever's actually loaded rather than leaving stray search text.
      const course = courseFor(roundIdx);
      const loadedName = course.courseId ? (findCourseInLibrary(course.courseId)?.name || course.name) : '';
      if (inp.value !== loadedName) inp.value = loadedName;
    }, 150);
  });
  list.addEventListener('pointerdown', (e) => {
    // pointerdown (not click) so this fires before the input's blur handler
    // on both mouse and touch — critical since this is primarily a mobile app.
    const item = e.target.closest('.course-combo-item');
    if (!item) return;
    e.preventDefault();
    const lib = findCourseInLibrary(item.dataset.id);
    if (!lib) return;
    const course = courseFor(roundIdx);
    if (lib.id === course.courseId) { list.style.display = 'none'; return; }
    if (!confirm(`Load "${lib.name}"? This replaces the course name, pars, and stroke indexes for Round ${roundIdx} with the saved course. Existing scores are kept.`)) {
      list.style.display = 'none';
      return;
    }
    applyLibraryCourseToRound(roundIdx, lib);
    list.style.display = 'none';
    renderAll();
  });
  if (clearBtn) {
    clearBtn.addEventListener('pointerdown', (e) => e.preventDefault()); // keep input from stealing blur before the clear registers
  }
}

function courseCard(roundIdx, dis) {
  dis = dis || '';
  const c = courseFor(roundIdx);
  const round = state.rounds[roundIdx - 1];
  // Wolf's tee-rotation math now works for 3 or 4 players — hide it from
  // the picker outside that range rather than let someone select a game
  // that will silently misbehave.
  const availableTypes = GAME_TYPE_ORDER.filter(t => t !== 'wolf' || [3, 4].includes(state.config.players.length));
  const typeOpts = availableTypes.map(val =>
    `<option value="${val}" ${round.type === val ? 'selected' : ''}>${GAME_TYPE_LABELS[val]}</option>`).join('');
  const isScramble = round.type === 'scramble';
  const is666 = round.type === '111';
  const winnerOpts = `<option value="">— Auto (leaderboard) —</option>` + playerIds().map(id =>
    `<option value="${id}" ${round.tournamentWinner === id ? 'selected' : ''}>${playerName(id)}</option>`).join('');
  const rotationOpts = is666 ? oneOneOneRotationOptions(c.holeCount || 18) : [];
  const currentRotation = (round.rotateEvery && rotationOpts.includes(round.rotateEvery)) ? round.rotateEvery : (rotationOpts[rotationOpts.length - 1] || 1);
  const currentCourseName = c.courseId ? (findCourseInLibrary(c.courseId)?.name || c.name) : '';
  return `<div class="card"><p class="eyebrow">Round ${roundIdx} — Game &amp; Course</p>
    <div class="field-row">
      <div class="field"><label>Game</label><select class="cfgRoundType" data-round="${roundIdx}" ${dis}>${typeOpts}</select></div>
      <div class="field"><label>Holes</label><select class="cfgRoundHoles" data-round="${roundIdx}" ${dis}>
        <option value="18" ${c.holeSet === '18' ? 'selected' : ''}>18 Holes</option>
        <option value="front9" ${c.holeSet === 'front9' ? 'selected' : ''}>9 Holes (Front)</option>
        <option value="back9" ${c.holeSet === 'back9' ? 'selected' : ''}>9 Holes (Back)</option>
      </select></div>
    </div>
    <div class="field course-combo-field">
      <label>Course</label>
      <div class="course-combo" data-round="${roundIdx}">
        <input type="text" class="course-combo-input" data-round="${roundIdx}" data-course-id="${c.courseId || ''}"
          value="${c.courseId ? escapeHtml(currentCourseName) : ''}"
          placeholder="Search saved courses or leave blank for custom…" autocomplete="off" ${dis}>
        <button type="button" class="course-combo-clear" data-round="${roundIdx}" style="display:${c.courseId ? 'flex' : 'none'};" ${dis} aria-label="Clear course selection">×</button>
        <div class="course-combo-list" data-round="${roundIdx}" style="display:none;"></div>
      </div>
      <p class="helper-text" style="margin-top:6px;">${c.courseId ? 'Linked to a saved course.' : 'Type to search saved courses — leave blank to keep a one-off custom course.'}</p>
    </div>
    ${c.courseId ? '' : `<div class="field"><label>Course Name</label><input type="text" class="cfgCourseName" data-round="${roundIdx}" value="${escapeHtml(c.name)}" ${dis}></div>`}
    ${dis ? '' : `<div class="field-row">
      <button type="button" class="btn btn-secondary cfgAddCourseBtn" data-round="${roundIdx}" style="flex:1;">+ Add New Course</button>
      ${c.courseId ? `<button type="button" class="btn btn-secondary cfgEditCourseBtn" data-round="${roundIdx}" style="flex:1;">✏️ Edit This Course</button>` : ''}
    </div>
    <p class="helper-text" style="margin-top:8px;">Courses are shared across every room — saving or editing one here updates it everywhere it's used.</p>`}
    ${is666 ? `
    <div class="field"><label>Rotate Solo Player Every</label><select class="cfgRotateEvery" data-round="${roundIdx}" ${dis}>
        ${rotationOpts.map(n => `<option value="${n}" ${currentRotation === n ? 'selected' : ''}>${n} hole${n === 1 ? '' : 's'}</option>`).join('')}
      </select>
      <p class="helper-text" style="margin-top:6px;">Classic "6-6-6" rotates every 6 holes on an 18-hole round. Only frequencies that divide evenly into this round's hole count are offered.</p>
    </div>` : ''}
    ${isScramble ? `<p class="helper-text" style="margin:0 0 10px;">Scramble has no Closest to the Pin or Longest Drive — it's just for fun and never counts toward the leaderboard.</p>` : `
    <div class="field-row">
      <div class="field"><label>Closest to the Pin — Hole #</label><input type="number" min="1" max="${c.holeCount}" class="cfgCtpHole" data-round="${roundIdx}" value="${c.ctpHole}" ${dis}></div>
      <div class="field"><label>Longest Drive — Hole #</label><input type="number" min="1" max="${c.holeCount}" class="cfgLdHole" data-round="${roundIdx}" value="${c.ldHole}" ${dis}></div>
    </div>`}
    <div class="field-row">
      <div class="field"><label>Round Date</label><input type="date" class="cfgRoundDate" data-round="${roundIdx}" value="${round.date || ''}" ${dis}></div>
      ${isScramble ? '' : `<div class="field"><label>Round Winner</label><select class="cfgRoundWinner" data-round="${roundIdx}" ${dis}>${winnerOpts}</select></div>`}
    </div>
    ${isScramble ? '' : `
    <div class="field" style="display:flex; align-items:center; gap:10px; margin-bottom:0;">
      <input type="checkbox" class="cfgExcludeLifetime" data-round="${roundIdx}" ${round.excludeFromLifetime ? 'checked' : ''} style="width:auto;" ${dis}>
      <label style="margin:0; text-transform:none; font-size:0.85rem; font-weight:600; color:var(--ink);">Exclude this round from lifetime stats</label>
    </div>`}
    <p class="helper-text" style="margin-top:10px;">Top box = par, bottom box = stroke index.${c.courseId ? ' Linked to a shared course — use "✏️ Edit This Course" above to change these.' : ''}</p>
    <p class="eyebrow" style="margin-top:0;">Pars &amp; Stroke Index</p>
    <div class="hole-grid">${c.holes.map((h, i) => `
      <div class="field hole-par-input">
        <label>Hole ${h.number}</label>
        <input type="number" class="cfgHolePar" data-round="${roundIdx}" data-hole-idx="${i}" value="${h.par}" style="margin-bottom:4px;" ${dis || c.courseId ? 'disabled' : ''}>
        <input type="number" class="cfgHoleIndex" data-round="${roundIdx}" data-hole-idx="${i}" value="${h.index}" ${dis || c.courseId ? 'disabled' : ''}>
      </div>`).join('')}
    </div>
  </div>`;
}

// Wolf now supports exactly 3 or 4 players (its tee-order rotation math
// works for either). If the roster moves outside that range, auto-convert
// any Wolf round to Match Play rather than leave it silently broken. Also
// repairs a stale wolfOrder length whenever the roster changes but stays
// within 3–4 (e.g. going from 3 to 4 players) — the order array must
// always match the current player count or getWolfOrderForHole falls back
// to un-set defaults.
function enforceWolfPlayerConstraint() {
  const n = state.config.players.length;
  const wolfEligible = n === 3 || n === 4;
  let changed = false;
  state.rounds.forEach(r => {
    if (r.type === 'wolf' && !wolfEligible) {
      r.type = 'matchplay3';
      r.gameName = GAME_TYPE_LABELS['matchplay3'];
      delete r.wolfOrder;
      changed = true;
    } else if (r.type === 'wolf' && (!r.wolfOrder || r.wolfOrder.length !== n)) {
      r.wolfOrder = playerIds();
      changed = true;
    }
  });
  if (changed && !wolfEligible) showToast('Wolf requires 3 or 4 players — affected rounds switched to Match Play');
}

function addPlayer() {
  if (state.config.players.length >= MAX_PLAYERS) { showToast(`Maximum ${MAX_PLAYERS} players`); return; }
  const n = state.config.players.length + 1;
  const id = 'p' + n;
  state.config.players.push({ id, name: `Player ${n}`, handicap: 0 });
  state.rounds.forEach(r => { Object.values(r.holes).forEach(h => { if (!(id in h) && r.type !== 'scramble') h[id] = null; }); });
  enforceWolfPlayerConstraint();
  saveState(); renderAll();
}

async function removeLastPlayer() {
  if (state.config.players.length <= MIN_PLAYERS) { showToast(`Need at least ${MIN_PLAYERS} players`); return; }
  const removed = state.config.players[state.config.players.length - 1];
  if (!confirm(`Remove ${removed.name}? This deletes their scores from every round and unassigns anyone currently playing as them. This can't be undone.`)) return;
  state.config.players.pop();
  state.rounds.forEach(r => {
    Object.values(r.holes).forEach(h => { delete h[removed.id]; });
    if (r.wolfOrder) r.wolfOrder = r.wolfOrder.filter(id => id !== removed.id);
    if (r.oneOneOneOrder) r.oneOneOneOrder = r.oneOneOneOrder.filter(id => id !== removed.id);
    if (r.ctpWinner === removed.id) r.ctpWinner = null;
    if (r.ldWinner === removed.id) r.ldWinner = null;
    if (r.tournamentWinner === removed.id) r.tournamentWinner = null;
  });
  enforceWolfPlayerConstraint();
  saveState(); renderAll();
  // Best-effort: unassign any room member currently playing as the removed slot.
  try {
    const members = await fetchRoomMembers();
    const affected = members.filter(m => m.playerId === removed.id);
    for (const m of affected) {
      await auth.client.rpc('admin_set_member_player', { p_room_id: auth.activeRoomId, p_user_id: m.userId, p_player_id: 'unassigned' });
    }
    if (affected.length) loadAndRenderMembers();
  } catch (e) { console.warn('Could not clean up member assignments after removing a player', e); }
}

function addRound() {
  if (state.rounds.length >= MAX_ROUNDS) { showToast(`Maximum ${MAX_ROUNDS} rounds`); return; }
  const idx = state.rounds.length + 1;
  state.config.courses.push(defaultCourse(`Round ${idx} Course`, 8, 13, 18));
  const newRound = { id: idx, type: 'matchplay3', label: `Round ${idx}`, gameName: GAME_TYPE_LABELS['matchplay3'], holes: {}, ctpWinner: null, ldWinner: null,
    date: null, excludeFromLifetime: false, tournamentWinner: null };
  for (let n = 1; n <= 18; n++) newRound.holes[n] = buildEmptyHole(newRound);
  state.rounds.push(newRound);
  saveState(); renderAll();
}

function removeLastRound() {
  if (state.rounds.length <= MIN_ROUNDS) { showToast(`Need at least ${MIN_ROUNDS} round`); return; }
  const idx = state.rounds.length;
  if (!confirm(`Remove Round ${idx}? This permanently deletes all its scores. This can't be undone.`)) return;
  state.rounds.pop();
  state.config.courses.pop();
  if (activeRoundTab > state.rounds.length) activeRoundTab = state.rounds.length;
  if (modalRound > state.rounds.length) modalRound = state.rounds.length;
  saveState(); renderAll();
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

  html += `<div class="card"><p class="eyebrow">Players &amp; Handicaps (${c.players.length})</p>`;
  c.players.forEach((p, i) => {
    html += `<div class="player-field-row">
      <div class="field player-name-field"><label>Player ${i + 1} Name</label><input type="text" data-player-idx="${i}" class="cfgPlayerName" value="${escapeHtml(p.name)}" ${dis}></div>
      <div class="field player-hcp-field"><label>Handicap</label><input type="number" step="0.1" data-player-idx="${i}" class="cfgPlayerHandicap" value="${p.handicap != null ? p.handicap : 0}" ${dis}></div>
    </div>`;
  });
  html += `<div class="field" style="display:flex; align-items:center; gap:10px; margin-bottom:0;">
      <input type="checkbox" id="cfgUseHandicaps" ${c.useHandicaps ? 'checked' : ''} style="width:auto;" ${dis}>
      <label style="margin:0; text-transform:none; font-size:0.85rem; font-weight:600; color:var(--ink);">Use handicaps for scoring (net strokes)</label>
    </div>
    <p class="helper-text" style="margin-top:8px;">When on, Match Play, Wolf, 6-6-6, Skins, and Stableford all compare net strokes — each player gets a stroke on their hardest holes by stroke index, based on the handicap above. Gross strokes are still what you enter and what the scorecard tracks; Scramble is unaffected (it has no individual strokes).</p>`;
  if (editable) {
    html += `<div class="field-row" style="margin-top:14px;">
      <button class="btn btn-secondary" id="addPlayerBtn" style="flex:1;" ${c.players.length >= MAX_PLAYERS ? 'disabled' : ''}>+ Add Player</button>
      <button class="btn btn-ghost" id="removePlayerBtn" style="flex:1;" ${c.players.length <= MIN_PLAYERS ? 'disabled' : ''}>− Remove Last</button>
    </div>
    ${![3, 4].includes(c.players.length) ? '<p class="helper-text" style="margin-top:8px;">Wolf requires 3 or 4 players and is hidden from the Game picker at this count.</p>' : ''}`;
  }
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

  html += `<div class="card"><p class="eyebrow">Wolf Point Allocation${[3,4].includes(c.players.length) ? '' : ' (3 or 4 players)'}</p>
    <div class="field-row">
      <div class="field"><label>Solo/Lone Win</label><input type="number" id="cfgWolfSoloWin" value="${c.wolf.soloWin}" ${dis}></div>
      <div class="field"><label>Team Win (each)</label><input type="number" id="cfgWolfTeamWin" value="${c.wolf.teamWin}" ${dis}></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Opponents Win (each)</label><input type="number" id="cfgWolfOppWin" value="${c.wolf.opponentWin}" ${dis}></div>
      <div class="field"><label>Blind Wolf Multiplier</label><input type="number" step="0.5" id="cfgWolfBlindMult" value="${c.wolf.blindMultiplier}" ${dis}></div>
    </div>
    <p class="helper-text">Blind Wolf = going lone before seeing any tee shots. Whatever the hole's points would be, they're multiplied by this value. Works with 3 or 4 players in the room — outside that range, Wolf rounds auto-convert to Match Play.</p>
  </div>`;

  html += `<div class="card"><p class="eyebrow">6-6-6 Point Allocation</p>
    <div class="field-row">
      <div class="field"><label>Solo Win</label><input type="number" id="cfg111Solo" value="${c.oneOneOne.soloWin}" ${dis}></div>
      <div class="field"><label>Team Win (each)</label><input type="number" id="cfg111Team" value="${c.oneOneOne.teamWin}" ${dis}></div>
    </div>
    <p class="helper-text">"6-6-6" is the classic name for this game when the solo player rotates every 6 holes — the rotation frequency for each round using this game type is set on that round's card below.</p>
  </div>`;

  html += `<div class="card"><p class="eyebrow">Skins</p>
    <div class="field"><label>Points per Skin</label><input type="number" step="0.5" id="cfgSkinsPointValue" value="${(c.skins && c.skins.pointValue) || 1}" ${dis}></div>
    <p class="helper-text">Lowest score on a hole wins the skin(s) riding on it. Ties carry every skin on that hole over to the next hole.</p>
  </div>`;

  html += `<div class="card"><p class="eyebrow">Round 1 Best Ball</p>
    <div class="field"><label>Best Ball Score Goal</label><input type="number" id="cfgBestBallGoal" value="${c.bestBallGoal}" ${dis}></div>
  </div>`;

  html += state.rounds.map((r, i) => courseCard(i + 1, dis)).join('');
  if (editable) {
    html += `<div class="card"><p class="eyebrow">Rounds (${state.rounds.length})</p>
      <div class="field-row">
        <button class="btn btn-secondary" id="addRoundBtn" style="flex:1;" ${state.rounds.length >= MAX_ROUNDS ? 'disabled' : ''}>+ Add Round</button>
        <button class="btn btn-ghost" id="removeRoundBtn" style="flex:1;" ${state.rounds.length <= MIN_ROUNDS ? 'disabled' : ''}>− Remove Last Round</button>
      </div>
    </div>`;
  }

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
  if (!editable) return;

  const addPlayerBtn = document.getElementById('addPlayerBtn');
  if (addPlayerBtn) addPlayerBtn.addEventListener('click', addPlayer);
  const removePlayerBtn = document.getElementById('removePlayerBtn');
  if (removePlayerBtn) removePlayerBtn.addEventListener('click', removeLastPlayer);
  const addRoundBtn = document.getElementById('addRoundBtn');
  if (addRoundBtn) addRoundBtn.addEventListener('click', addRound);
  const removeRoundBtn = document.getElementById('removeRoundBtn');
  if (removeRoundBtn) removeRoundBtn.addEventListener('click', removeLastRound);

  // Focus/tab fix: field-level edits (numbers, names, handicaps, course
  // fields, hole grids) save + refresh every OTHER view, but deliberately
  // do NOT call renderAll()/renderGameSettings() here — re-rendering this
  // panel's own innerHTML on every blur was what caused the "have to
  // select twice" / tab-not-advancing bug (see refreshNonSettingsViews
  // doc comment below for the full explanation). Structural edits that
  // change which fields exist (round type, hole count, PIN unlock, add/
  // remove player or round) still do a full renderAll(), since those are
  // infrequent, confirm()-gated actions rather than something a user tabs
  // through field-by-field.
  const bind = (id, path, isNum) => {
    const inp = document.getElementById(id);
    if (!inp) return;
    inp.addEventListener('change', () => { setPath(path, isNum ? Number(inp.value) : inp.value); saveState(); refreshNonSettingsViews(); });
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
  if (openScoringEl) openScoringEl.addEventListener('change', () => { state.config.openScoring = openScoringEl.checked; saveState(); refreshNonSettingsViews(); });
  bind('cfgWolfSoloWin', ['wolf', 'soloWin'], true);
  bind('cfgWolfTeamWin', ['wolf', 'teamWin'], true);
  bind('cfgWolfOppWin', ['wolf', 'opponentWin'], true);
  bind('cfgWolfBlindMult', ['wolf', 'blindMultiplier'], true);
  bind('cfg111Solo', ['oneOneOne', 'soloWin'], true);
  bind('cfg111Team', ['oneOneOne', 'teamWin'], true);
  bind('cfgSkinsPointValue', ['skins', 'pointValue'], true);
  bind('cfgBestBallGoal', ['bestBallGoal'], true);
  const useHcpEl = document.getElementById('cfgUseHandicaps');
  if (useHcpEl) useHcpEl.addEventListener('change', () => { state.config.useHandicaps = useHcpEl.checked; saveState(); refreshNonSettingsViews(); });

  el.querySelectorAll('.cfgPlayerName').forEach(inp => {
    inp.addEventListener('change', () => { state.config.players[Number(inp.dataset.playerIdx)].name = inp.value; saveState(); refreshNonSettingsViews(); });
  });
  el.querySelectorAll('.cfgPlayerHandicap').forEach(inp => {
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      state.config.players[Number(inp.dataset.playerIdx)].handicap = isNaN(v) ? 0 : v;
      saveState(); refreshNonSettingsViews();
    });
  });
  el.querySelectorAll('.cfgCourseName').forEach(inp => {
    inp.addEventListener('change', () => { courseFor(Number(inp.dataset.round)).name = inp.value; saveState(); refreshNonSettingsViews(); });
  });
  el.querySelectorAll('.course-combo-input').forEach(inp => {
    wireCourseCombo(inp);
  });
  el.querySelectorAll('.course-combo-clear').forEach(btn => {
    btn.addEventListener('click', () => {
      const roundIdx = Number(btn.dataset.round);
      const course = courseFor(roundIdx);
      if (!course.courseId) return;
      // Detach from the library — keep whatever pars/indexes are
      // currently loaded, just make them freely editable again.
      course.courseId = null;
      saveState(); renderAll();
    });
  });
  el.querySelectorAll('.cfgAddCourseBtn').forEach(btn => {
    btn.addEventListener('click', () => openCourseEditor(Number(btn.dataset.round), null));
  });
  el.querySelectorAll('.cfgEditCourseBtn').forEach(btn => {
    btn.addEventListener('click', () => openCourseEditor(Number(btn.dataset.round), courseFor(Number(btn.dataset.round)).courseId));
  });
  el.querySelectorAll('.cfgCtpHole').forEach(inp => {
    inp.addEventListener('change', () => {
      const course = courseFor(Number(inp.dataset.round));
      course.ctpHole = Math.min(Math.max(1, Number(inp.value) || 1), course.holeCount || 18);
      saveState(); refreshNonSettingsViews();
    });
  });
  el.querySelectorAll('.cfgLdHole').forEach(inp => {
    inp.addEventListener('change', () => {
      const course = courseFor(Number(inp.dataset.round));
      course.ldHole = Math.min(Math.max(1, Number(inp.value) || 1), course.holeCount || 18);
      saveState(); refreshNonSettingsViews();
    });
  });
  el.querySelectorAll('.cfgRoundDate').forEach(inp => {
    inp.addEventListener('change', () => {
      state.rounds[Number(inp.dataset.round) - 1].date = inp.value || null;
      saveState(); renderAll();
    });
  });
  el.querySelectorAll('.cfgRoundWinner').forEach(sel => {
    sel.addEventListener('change', () => {
      state.rounds[Number(sel.dataset.round) - 1].tournamentWinner = sel.value || null;
      saveState(); renderAll();
    });
  });
  el.querySelectorAll('.cfgExcludeLifetime').forEach(inp => {
    inp.addEventListener('change', () => {
      state.rounds[Number(inp.dataset.round) - 1].excludeFromLifetime = inp.checked;
      saveState(); renderAll();
    });
  });
  el.querySelectorAll('.cfgRoundType').forEach(sel => {
    sel.addEventListener('change', () => {
      const roundIdx = Number(sel.dataset.round);
      const round = state.rounds[roundIdx - 1];
      const newType = sel.value;
      if (newType === round.type) return;
      const switchingScramble = newType === 'scramble' || round.type === 'scramble';
      const warnMsg = switchingScramble
        ? `Change Round ${roundIdx} to ${GAME_TYPE_LABELS[newType]}? Scramble uses a different scorecard, so existing hole scores for this round will be cleared.`
        : `Change Round ${roundIdx} to ${GAME_TYPE_LABELS[newType]}? Existing strokes are kept, but game points will be recalculated under the new rules.`;
      if (!confirm(warnMsg)) { sel.value = round.type; return; }
      round.type = newType;
      round.gameName = GAME_TYPE_LABELS[newType];
      if (switchingScramble) {
        round.ctpWinner = null; round.ldWinner = null;
        const holeCount = courseFor(roundIdx).holeCount || 18;
        const holes = {};
        for (let n = 1; n <= holeCount; n++) holes[n] = buildEmptyHole(round);
        round.holes = holes;
      }
      if (newType === 'wolf' && (!round.wolfOrder || round.wolfOrder.length !== playerIds().length)) round.wolfOrder = playerIds();
      if (newType !== 'wolf') delete round.wolfOrder;
      if (newType === '111' && (!round.oneOneOneOrder || round.oneOneOneOrder.length !== playerIds().length)) round.oneOneOneOrder = playerIds();
      if (newType === '111' && round.rotateEvery == null) round.rotateEvery = 6;
      saveState(); renderAll();
    });
  });
  el.querySelectorAll('.cfgRoundHoles').forEach(sel => {
    sel.addEventListener('change', () => {
      const roundIdx = Number(sel.dataset.round);
      const newHoleSet = sel.value; // '18' | 'front9' | 'back9'
      const course = courseFor(roundIdx);
      const round = state.rounds[roundIdx - 1];
      if (newHoleSet === course.holeSet) return;
      const newCount = holeSetToCount(newHoleSet);
      if (newCount < course.holeCount) {
        if (!confirm(`Switching Round ${roundIdx} to 9 holes will permanently delete any entered scores for holes 10–18. Continue?`)) {
          sel.value = course.holeSet; return;
        }
      }
      course.holeSet = newHoleSet;
      if (course.courseId) {
        // Linked to the shared library — re-pull the appropriate 9/18
        // holes' pars & indexes straight from the source course rather
        // than trying to slice/pad whatever was already in course.holes.
        const lib = findCourseInLibrary(course.courseId);
        if (lib) course.holes = holesForSet(lib.holes, newHoleSet);
      }
      resizeCourseHoles(course, newCount);
      resizeRoundHoles(round, newCount);
      // A rotation frequency valid for the old hole count may no longer
      // divide evenly into the new one (e.g. rotate-every-6 on 18 holes
      // isn't valid at 9) — fall back to the largest still-valid option.
      if (round.type === '111') {
        const stillValid = oneOneOneRotationOptions(newCount);
        if (!round.rotateEvery || !stillValid.includes(round.rotateEvery)) {
          round.rotateEvery = stillValid[stillValid.length - 1] || 1;
        }
      }
      saveState(); renderAll();
    });
  });
  el.querySelectorAll('.cfgRotateEvery').forEach(sel => {
    sel.addEventListener('change', () => {
      state.rounds[Number(sel.dataset.round) - 1].rotateEvery = Number(sel.value);
      saveState(); refreshNonSettingsViews();
    });
  });
  el.querySelectorAll('.cfgHolePar').forEach(inp => {
    inp.addEventListener('change', () => { courseFor(Number(inp.dataset.round)).holes[Number(inp.dataset.holeIdx)].par = Number(inp.value); saveState(); refreshNonSettingsViews(); });
  });
  el.querySelectorAll('.cfgHoleIndex').forEach(inp => {
    inp.addEventListener('change', () => { courseFor(Number(inp.dataset.round)).holes[Number(inp.dataset.holeIdx)].index = Number(inp.value); saveState(); refreshNonSettingsViews(); });
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
    <div class="field"><label>${isViewingLive() ? 'Current Season Name' : 'This Season\'s Name'}</label><input type="text" id="cfgSeasonName" value="${escapeHtml(state.year)}" placeholder="e.g. 2027 or The Masters at Pebble"></div>
    <button class="btn btn-secondary btn-block" id="saveSeasonNameBtn">Save Season Name</button>
    <p class="helper-text" style="margin:10px 0;">Seasons no longer have to be a year — call this trip whatever you like. Archiving snapshots this season's final scores, then clears the scorecards for the next trip. Everyone can browse past seasons from Home using the ‹ › arrows, and you can edit them there too. Use the trash icon next to an archived season's name on Home to delete it permanently (the live season can't be deleted here).</p>
    <button class="btn btn-secondary btn-block" id="startNewYearBtn">Archive "${escapeHtml(state.year)}" &amp; Start New Season</button>
    <button class="btn btn-ghost btn-block" id="addBacklogYearBtn" style="margin-top:10px;">+ Add a Past Season (Backfill)</button>
    <p class="helper-text" style="margin-top:8px;">Adds a blank season to the archive so you can go fill in old scores you never entered — use the ‹ › arrows on Home to open it.</p>
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
  document.getElementById('saveSeasonNameBtn').addEventListener('click', () => {
    const val = document.getElementById('cfgSeasonName').value.trim();
    renameCurrentSeason(val);
  });
  document.getElementById('startNewYearBtn').addEventListener('click', () => {
    const guess = (() => { const n = parseInt(state.year, 10); return isNaN(n) ? '' : String(n + 1); })();
    const label = prompt('Name for the new season (e.g. "2028" or "Spring Trip"):', guess);
    if (!label) return;
    if (!confirm(`Archive "${state.year}" and reset all scores for "${label}"? This can't be undone.`)) return;
    archiveAndStartNewYear(label);
  });
  document.getElementById('addBacklogYearBtn').addEventListener('click', () => {
    const label = prompt('Name for the season you\'re backfilling (e.g. "2023" or "Fall Classic"):');
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

// Re-renders everything EXCEPT the settings form (gameSettingsSection /
// adminSettingsSection) — used after a settings field save so the rest of
// the app (leaderboard, scorecard, stats, header) reflects the change
// without rebuilding the settings panel's own inputs, which is what was
// stealing keyboard focus / breaking Tab order (see renderGameSettings'
// binding comment for the full explanation).
function refreshNonSettingsViews() {
  renderHeader();
  renderSeasonNav();
  renderRoundStatus();
  renderLeaderboard();
  renderRoundsView();
  renderStats();
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

function firstUnenteredHole(round, holeCount) {
  const max = holeCount || 18;
  if (round.type === 'scramble') {
    for (let n = 1; n <= max; n++) { if (round.holes[n].team == null) return n; }
    return null;
  }
  const ids = playerIds();
  for (let n = 1; n <= max; n++) {
    if (!allEntered(round.holes[n], ids)) return n;
  }
  return null; // this round is fully complete
}

function openScoreModal() {
  let round = activeRoundTab;
  let hole = firstUnenteredHole(state.rounds[round - 1], courseFor(round).holeCount);
  if (hole == null) {
    // this round is done — look for the next round (in order) with open holes
    const totalRounds = state.rounds.length;
    for (let i = 1; i <= totalRounds; i++) {
      const r = ((round - 1 + i) % totalRounds) + 1;
      const h = firstUnenteredHole(state.rounds[r - 1], courseFor(r).holeCount);
      if (h != null) { round = r; hole = h; break; }
    }
    if (hole == null) hole = courseFor(round).holeCount || 18; // every round is fully complete — just show something
  }
  modalRound = round;
  modalHole = hole;
  document.getElementById('scoreModal').classList.remove('hidden');
  renderModalRoundTabs();

  const gate = document.getElementById('modalLoginGate');
  const body = document.getElementById('modalScoreBody');
  if (!canEditAnyScore()) {
    const gateText = document.getElementById('modalLoginGateText');
    if (!isViewingLive()) gateText.textContent = `You're viewing ${state.year} in read-only mode. Jump back to the live season on Home to enter scores.`;
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
  modalHole = firstUnenteredHole(state.rounds[modalRound - 1], courseFor(modalRound).holeCount) ?? (courseFor(modalRound).holeCount || 18);
  renderModalHole();
});

document.getElementById('prevHoleBtn').addEventListener('click', () => { if (modalHole > 1) { modalHole--; renderModalHole(); } });
document.getElementById('nextHoleBtn').addEventListener('click', () => { const max = courseFor(modalRound).holeCount || 18; if (modalHole < max) { modalHole++; renderModalHole(); } });

// Wolf choice labels now work for 3 or 4 players — 'value' is either
// 'lone', 'blind', or a partner's player id directly (replacing the old
// 3-player-only 'first'/'second' scheme, which assumed exactly 2 other
// players and couldn't express "pick one of 3 possible partners").
function wolfChoiceLabel(value) {
  if (value === 'lone') return `Lone Wolf`;
  if (value === 'blind') return `Blind Wolf (${state.config.wolf.blindMultiplier || 2}x)`;
  return `Team w/ ${playerName(value)}`;
}

function renderModalHole() {
  renderModalRoundTabs();
  const round = state.rounds[modalRound - 1];
  const hd = round.holes[modalHole];
  const par = holeConfig(modalRound, modalHole).par;
  const ids = playerIds();
  const loggedInId = myPlayerId();
  const course = courseFor(modalRound);
  const isScramble = round.type === 'scramble';

  document.getElementById('modalRoundTitle').textContent = `${round.label} · ${round.gameName}`;
  document.getElementById('modalHoleNumber').textContent = `Hole ${modalHole}`;

  const isCtp = !isScramble && modalHole === course.ctpHole;
  const isLd = !isScramble && modalHole === course.ldHole;
  let parText = `Par ${par}`;
  if (isCtp || isLd) {
    const tags = [];
    if (isCtp) tags.push('📍 CTP');
    if (isLd) tags.push('🏌️ Longest Drive');
    parText += ` · ${tags.join(' · ')}`;
  }
  document.getElementById('modalHolePar').textContent = parText;

  const saveBtn = document.getElementById('saveHoleBtn');
  const alreadyEntered = isScramble ? (hd.team != null) : allEntered(hd, ids);
  saveBtn.textContent = alreadyEntered ? 'Edit Hole' : 'Save Hole';
  saveBtn.classList.toggle('btn-primary', !alreadyEntered);
  saveBtn.classList.toggle('btn-edit', alreadyEntered);

  const clearBtn = document.getElementById('clearHoleBtn');
  if (clearBtn) {
    const anyEntered = isScramble ? (hd.team != null) : ids.some(id => hd[id] != null && hd[id] !== '');
    clearBtn.style.display = anyEntered ? 'block' : 'none';
  }

  const notice = document.getElementById('modalLoginNotice');
  notice.style.display = 'block';
  notice.textContent = isAdmin()
    ? `Admin mode — all strokes are editable.`
    : isScramble
      ? (canEditAnyScore() ? `Scramble is a shared team score — anyone with edit access can enter it.` : `Pick which player you are in Account & Rooms to unlock scoring.`)
      : state.config.openScoring
        ? `Open scoring is on for this room — anyone can edit any player's strokes.`
        : loggedInId
          ? `Playing as ${playerName(loggedInId)} — only your strokes are editable.`
          : `Pick which player you are in Account & Rooms to unlock your strokes.`;

  const wolfOrderBlock = document.getElementById('modalWolfOrderBlock');
  if (round.type === 'wolf' && modalHole === 1) {
    wolfOrderBlock.style.display = 'block';
    const n = ids.length;
    const order = (round.wolfOrder && round.wolfOrder.length === n) ? round.wolfOrder : playerIds();
    const orderDiv = document.getElementById('modalWolfOrderInputs');
    orderDiv.innerHTML = Array.from({ length: n }, (_, pos) => pos).map(pos => `
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

  const oneOneOneOrderBlock = document.getElementById('modalOneOneOneOrderBlock');
  if (oneOneOneOrderBlock) {
    if (round.type === '111' && modalHole === 1) {
      oneOneOneOrderBlock.style.display = 'block';
      // The rotation order only needs to name who's solo each hole, so its
      // length matches player count generally (though only the first N
      // matter — 1-1-1's "team" is just everyone else, whatever the count).
      const n = ids.length;
      const order = (round.oneOneOneOrder && round.oneOneOneOrder.length === n) ? round.oneOneOneOrder : playerIds();
      const orderDiv = document.getElementById('modalOneOneOneOrderInputs');
      orderDiv.innerHTML = Array.from({ length: n }, (_, pos) => pos).map(pos => `
        <div class="field"><label>Position ${pos + 1}</label>
          <select class="oneOneOneOrderSelect" data-pos="${pos}">
            ${ids.map(id => `<option value="${id}" ${order[pos] === id ? 'selected' : ''}>${playerName(id)}</option>`).join('')}
          </select>
        </div>`).join('');
      orderDiv.querySelectorAll('.oneOneOneOrderSelect').forEach(sel => {
        sel.addEventListener('change', () => {
          const newOrder = Array.from(orderDiv.querySelectorAll('.oneOneOneOrderSelect')).map(s => s.value);
          round.oneOneOneOrder = newOrder;
          saveState();
          renderModalHole();
        });
      });
    } else {
      oneOneOneOrderBlock.style.display = 'none';
    }
  }

  const inputsDiv = document.getElementById('modalScoreInputs');
  if (isScramble) {
    const locked = !canEditAnyScore();
    const val = hd.team != null ? hd.team : par;
    inputsDiv.innerHTML = `<div class="score-input-row ${locked ? 'locked-row' : ''}">
      <label>Team Score</label>
      <div class="stepper">
        <button type="button" class="stepDown" data-player="team" ${locked ? 'disabled' : ''}>−</button>
        <input type="number" class="scoreVal" data-player="team" value="${val}" min="1" max="20" ${locked ? 'disabled' : ''}>
        <button type="button" class="stepUp" data-player="team" ${locked ? 'disabled' : ''}>+</button>
      </div>
    </div>`;
  } else {
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
  }

  inputsDiv.querySelectorAll('.stepDown').forEach(b => b.addEventListener('click', () => stepScore(b.dataset.player, -1)));
  inputsDiv.querySelectorAll('.stepUp').forEach(b => b.addEventListener('click', () => stepScore(b.dataset.player, 1)));
  inputsDiv.querySelectorAll('.scoreVal').forEach(inp => inp.addEventListener('change', renderModalPreview));

  const wolfBlock = document.getElementById('modalWolfBlock');
  const matchupBlock = document.getElementById('modalMatchupBlock');
  const holeCountForModal = course.holeCount || 18;

  if (round.type === 'wolf') {
    wolfBlock.style.display = 'block';
    matchupBlock.style.display = 'none';
    const { wolf: wolfPlayer, others } = getWolfOrderForHole(round, modalHole, holeCountForModal);
    document.getElementById('modalWolfWhoText').textContent = `${playerName(wolfPlayer)} is the wolf this hole.`;
    const current = hd.wolf ? hd.wolf.partner : 'lone';
    const opts = document.getElementById('modalWolfOptions');
    // choices: blind, one option per possible partner (2 or 3 depending on
    // player count), then lone — 'others' already excludes the wolf.
    const choices = ['blind', ...others, 'lone'];
    opts.innerHTML = choices.map(v => `<label class="radio-chip"><input type="radio" name="wolfChoice" value="${v}" ${current === v ? 'checked' : ''}><span>${wolfChoiceLabel(v)}</span></label>`).join('');
    opts.querySelectorAll('input').forEach(inp => inp.addEventListener('change', renderModalPreview));
  } else if (round.type === '111') {
    wolfBlock.style.display = 'none';
    matchupBlock.style.display = 'block';
    const soloPlayer = getOneOneOneSoloForHole(round, modalHole, holeCountForModal);
    const teamIds = ids.filter(id => id !== soloPlayer);
    document.getElementById('modalMatchupTitle').textContent = 'Matchup';
    document.getElementById('modalMatchupText').textContent = `${playerName(soloPlayer)} (solo) vs. ${teamIds.map(playerName).join(' & ')} (team)`;
  } else if (round.type === 'skins') {
    wolfBlock.style.display = 'none';
    matchupBlock.style.display = 'block';
    document.getElementById('modalMatchupTitle').textContent = 'Skins';
    const rc = computeRound(round, modalRound);
    const priorHole = rc.perHole.find(h => h.number === modalHole - 1);
    const carryIn = priorHole && priorHole.meta ? priorHole.meta.carryOut : 0;
    document.getElementById('modalMatchupText').textContent = carryIn > 0
      ? `${carryIn} skin${carryIn === 1 ? '' : 's'} carried in from a tie — this hole is worth ${carryIn + 1}.`
      : `Lowest score wins the skin. A tie carries it to the next hole.`;
  } else {
    wolfBlock.style.display = 'none';
    matchupBlock.style.display = 'none';
  }

  renderModalPreview();
}

function stepScore(playerId, delta) {
  const inp = document.querySelector(`.scoreVal[data-player="${playerId}"]`);
  if (inp.disabled) return;
  const round = state.rounds[modalRound - 1];
  const max = round.type === 'scramble' ? 20 : 15;
  const next = Math.max(1, Math.min(max, Number(inp.value) + delta));
  inp.value = next;
  renderModalPreview();
}

function readModalTempHole() {
  const round = state.rounds[modalRound - 1];
  if (round.type === 'scramble') {
    const inp = document.querySelector(`.scoreVal[data-player="team"]`);
    return { team: inp ? Number(inp.value) : null };
  }
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

  if (round.type === 'none' || round.type === 'scramble') {
    resultBlock.style.display = 'none';
    return;
  }
  resultBlock.style.display = 'block';

  const hc = holeConfig(modalRound, modalHole);
  const holeCount = courseFor(modalRound).holeCount || 18;
  const ids = playerIds();

  if (round.type === 'matchplay3') {
    resultTitle.textContent = 'Match Play Result';
    const pts = matchPlayHolePoints(temp, ids, hc.index, holeCount);
    if (!pts) { resultText.textContent = 'Enter all strokes to see the result.'; return; }
    const parts = ids.map(id => `${playerName(id)}: ${fmtNum(pts[id])} pt${pts[id] === 1 ? '' : 's'}`);
    resultText.textContent = parts.join(' · ');
  } else if (round.type === 'wolf') {
    resultTitle.textContent = 'Wolf Result';
    const w = wolfHolePoints(temp, modalHole, round, hc.index, holeCount);
    if (!w) { resultText.textContent = 'Enter all strokes to see the result.'; return; }
    const tag = w.blind ? ' (blind — doubled!)' : '';
    if (w.outcome === 'team-win') resultText.textContent = `${w.teamIds.map(playerName).join(' & ')} win the hole${tag}.`;
    else if (w.outcome === 'opp-win') resultText.textContent = `${w.oppIds.map(playerName).join(' & ')} beat the wolf${tag}.`;
    else resultText.textContent = 'Hole tied — no points awarded.';
  } else if (round.type === '111') {
    resultTitle.textContent = '6-6-6 Result';
    const o = oneOneOneHolePoints(temp, modalHole, round, hc.index, holeCount);
    if (!o) { resultText.textContent = 'Enter all strokes to see the result.'; return; }
    if (o.outcome === 'solo-win') resultText.textContent = `${playerName(o.soloPlayer)} wins solo (+${state.config.oneOneOne.soloWin}).`;
    else if (o.outcome === 'team-win') resultText.textContent = `${o.teamIds.map(playerName).join(' & ')} win as a team (+${state.config.oneOneOne.teamWin} each).`;
    else resultText.textContent = 'Hole tied — no points awarded.';
  } else if (round.type === 'skins') {
    resultTitle.textContent = 'Skins Result';
    if (!allEntered(temp, ids)) { resultText.textContent = 'Enter all strokes to see the result.'; return; }
    const rc = computeRound(round, modalRound);
    const priorHole = rc.perHole.find(h => h.number === modalHole - 1);
    const carryIn = priorHole && priorHole.meta ? priorHole.meta.carryOut : 0;
    const s = skinsHolePoints(temp, ids, hc.index, holeCount, carryIn);
    const pointValue = (state.config.skins && state.config.skins.pointValue) || 1;
    if (s.winner) resultText.textContent = `${playerName(s.winner)} wins ${s.skinsWon} skin${s.skinsWon === 1 ? '' : 's'} (${fmtNum(s.skinsWon * pointValue)} pts).`;
    else resultText.textContent = `Tied — ${carryIn + 1} skin${carryIn + 1 === 1 ? '' : 's'} carr${carryIn + 1 === 1 ? 'ies' : 'y'} over to the next hole.`;
  }
}

document.getElementById('saveHoleBtn').addEventListener('click', () => {
  const round = state.rounds[modalRound - 1];
  const temp = readModalTempHole();
  const holeData = round.holes[modalHole];
  if (round.type === 'scramble') {
    if (canEditAnyScore()) holeData.team = temp.team;
  } else {
    playerIds().forEach(id => {
      if (!canEditPlayer(id)) return;
      holeData[id] = temp[id];
    });
    if (round.type === 'wolf' && temp.wolf) holeData.wolf = temp.wolf;
  }
  saveState();
  renderRoundsView();
  renderLeaderboard();
  renderRoundStatus();
  renderStats();
  const maxHole = courseFor(modalRound).holeCount || 18;
  if (modalHole < maxHole) {
    modalHole++;
    renderModalHole();
    showToast(`Hole ${modalHole - 1} saved`);
  } else {
    showToast(`Hole ${maxHole} saved — round complete!`);
    closeScoreModal();
  }
});

// Clear all strokes (and wolf choice) for the currently-open hole. Only
// clears players the current user is allowed to edit — mirrors the same
// per-player permission check used when saving.
document.getElementById('clearHoleBtn')?.addEventListener('click', () => {
  if (!confirm(`Clear all scores entered for Hole ${modalHole}?`)) return;
  const round = state.rounds[modalRound - 1];
  const holeData = round.holes[modalHole];
  let clearedAny = false;
  if (round.type === 'scramble') {
    if (canEditAnyScore() && holeData.team != null) { holeData.team = null; clearedAny = true; }
  } else {
    playerIds().forEach(id => {
      if (!canEditPlayer(id)) return;
      if (holeData[id] != null) { holeData[id] = null; clearedAny = true; }
    });
    if (round.type === 'wolf' && isAdmin()) holeData.wolf = { partner: 'lone' };
  }
  if (!clearedAny) { showToast('Nothing to clear'); return; }
  saveState();
  renderRoundsView();
  renderLeaderboard();
  renderRoundStatus();
  renderStats();
  renderModalHole();
  showToast(`Hole ${modalHole} cleared`);
});

/* ---------------------------------------------------------------
   COURSE EDITOR MODAL — add/edit a shared golf_courses library entry
---------------------------------------------------------------- */
// Which round is being edited/added-for when the course editor is open,
// and (if editing) which existing library course id is being updated.
let courseEditorRoundIdx = null;
let courseEditorCourseId = null;

function openCourseEditor(roundIdx, courseId) {
  courseEditorRoundIdx = roundIdx;
  courseEditorCourseId = courseId || null;
  const isEdit = !!courseId;
  document.getElementById('courseEditorTitle').textContent = isEdit ? 'Edit Course' : 'Add Course';
  document.getElementById('courseEditorScopeText').textContent = isEdit
    ? 'This course is shared across every room — saving changes here updates it everywhere it\'s used.'
    : 'Courses are shared across every room — everyone will see this course in their picker.';

  let nameVal = '';
  let holesVal = defaultHoles(18);
  if (isEdit) {
    const lib = findCourseInLibrary(courseId);
    if (lib) { nameVal = lib.name; holesVal = holesForSet(lib.holes, '18'); }
  }
  document.getElementById('courseEditorName').value = nameVal;

  const grid = document.getElementById('courseEditorHoleGrid');
  grid.innerHTML = holesVal.map((h, i) => `
    <div class="field hole-par-input">
      <label>Hole ${h.number}</label>
      <input type="number" class="courseEditorPar" data-hole-idx="${i}" value="${h.par}" style="margin-bottom:4px;">
      <input type="number" class="courseEditorIndex" data-hole-idx="${i}" value="${h.index}">
    </div>`).join('');

  document.getElementById('courseEditorModal').classList.remove('hidden');
}

function closeCourseEditor() { document.getElementById('courseEditorModal').classList.add('hidden'); }

document.getElementById('closeCourseEditorBtn').addEventListener('click', closeCourseEditor);
document.getElementById('courseEditorModal').addEventListener('click', (e) => { if (e.target.id === 'courseEditorModal') closeCourseEditor(); });

document.getElementById('saveCourseBtn').addEventListener('click', async () => {
  const name = document.getElementById('courseEditorName').value.trim();
  if (!name) { showToast('Enter a course name'); return; }
  const pars = Array.from(document.querySelectorAll('.courseEditorPar')).map(inp => Number(inp.value) || 4);
  const idxs = Array.from(document.querySelectorAll('.courseEditorIndex')).map(inp => Number(inp.value) || 1);
  const holes = pars.map((par, i) => ({ number: i + 1, par, index: idxs[i] }));

  const btn = document.getElementById('saveCourseBtn');
  btn.disabled = true;
  try {
    const savedId = await saveCourseToLibrary(courseEditorCourseId, name, holes);
    if (!savedId) return; // saveCourseToLibrary already toasted the error
    // Apply the saved course to the round that triggered the editor, using
    // whatever hole set (18/front9/back9) that round is currently set to.
    if (courseEditorRoundIdx) {
      applyLibraryCourseToRound(courseEditorRoundIdx, { id: savedId, name, holes });
    }
    closeCourseEditor();
    renderAll();
    showToast(courseEditorCourseId ? 'Course updated' : 'Course added');
  } finally {
    btn.disabled = false;
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
