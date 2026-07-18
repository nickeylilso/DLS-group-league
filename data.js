// data.js — shared cloud storage via JSONBin.io
// Used by index.html, admin.html, team.html, fixture.html

const JSONBIN_BIN_ID = "6a4f8f67f5f4af5e297729db";
const JSONBIN_API_KEY = "$2a$10$1YKDZY/xBG8zmm8plP.JvuExTB.4vK1B4fywqF7suieQOMYoocmKW";
const JSONBIN_BASE = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

const ADMIN_PASSWORD = "dlsboss2026";
const ADMIN_SESSION_KEY = "dls_admin_unlocked_session";

function emptyState() {
  return {
    teams: [],
    matches: [],
    fixtures: [],
    announcements: [],
    about: "",
    matchdayCounter: 1
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---- cloud read/write ----
async function fetchData() {
  const res = await fetch(JSONBIN_BASE + "/latest", {
    method: "GET",
    headers: { "X-Master-Key": JSONBIN_API_KEY }
  });
  if (!res.ok) throw new Error("Failed to load data (status " + res.status + ")");
  const json = await res.json();
  const record = json.record || {};
  const fresh = emptyState();
  return {
    teams: Array.isArray(record.teams) ? record.teams : fresh.teams,
    matches: Array.isArray(record.matches) ? record.matches : fresh.matches,
    fixtures: Array.isArray(record.fixtures) ? record.fixtures : fresh.fixtures,
    announcements: Array.isArray(record.announcements)
      ? record.announcements
      : (typeof record.announcement === "string" && record.announcement
          ? [{ id: uid(), text: record.announcement, ts: Date.now() }]
          : fresh.announcements),
    about: typeof record.about === "string" ? record.about : fresh.about,
    matchdayCounter: typeof record.matchdayCounter === "number" ? record.matchdayCounter : 1
  };
}

async function pushData(data) {
  const res = await fetch(JSONBIN_BASE, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": JSONBIN_API_KEY
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error("Failed to save data (status " + res.status + ")");
  return true;
}

// ---- table logic ----
function sortTeams(list) {
  return [...list].sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    const gdA = a.gf - a.ga, gdB = b.gf - b.ga;
    if (gdB !== gdA) return gdB - gdA;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.name.localeCompare(b.name);
  });
}

function gd(team) {
  return team.gf - team.ga;
}

// ---- teams ----
function addTeam(data, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return false;
  if (data.teams.some(t => t.name.toLowerCase() === trimmed.toLowerCase())) return false;
  data.teams.push({
    id: uid(), name: trimmed, logo: null,
    played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0,
    form: [],
    history: []
  });
  return true;
}

function removeTeam(data, id) {
  const idx = data.teams.findIndex(t => t.id === id);
  if (idx === -1) return false;
  data.teams.splice(idx, 1);
  data.matches = data.matches.filter(m => m.teamAId !== id && m.teamBId !== id);
  data.fixtures = data.fixtures.filter(f => f.teamAId !== id && f.teamBId !== id);
  recalculateAllStats(data);
  return true;
}

function setTeamLogo(data, id, dataUrl) {
  const t = data.teams.find(x => x.id === id);
  if (!t) return false;
  t.logo = dataUrl;
  return true;
}

function removeTeamLogo(data, id) {
  const t = data.teams.find(x => x.id === id);
  if (!t) return false;
  t.logo = null;
  return true;
}

function editTeamName(data, id, newName) {
  const trimmed = (newName || "").trim();
  if (!trimmed) return false;
  const clash = data.teams.some(t => t.id !== id && t.name.toLowerCase() === trimmed.toLowerCase());
  if (clash) return false;
  const t = data.teams.find(x => x.id === id);
  if (!t) return false;
  t.name = trimmed;
  return true;
}

// ---- results ----
function recordResult(data, teamAId, scoreA, teamBId, scoreB, matchday) {
  if (teamAId === teamBId) return false;
  const a = data.teams.find(t => t.id === teamAId);
  const b = data.teams.find(t => t.id === teamBId);
  if (!a || !b) return false;

  data.matches.unshift({
    id: uid(), teamAId, teamBId, scoreA, scoreB, ts: Date.now(),
    matchday: matchday || null
  });
  recalculateAllStats(data);
  maybeSnapshotCompletedMatchday(data, matchday);
  return true;
}

function editMatchResult(data, matchId, newScoreA, newScoreB) {
  const m = data.matches.find(x => x.id === matchId);
  if (!m) return false;
  m.scoreA = newScoreA;
  m.scoreB = newScoreB;
  recalculateAllStats(data);
  return true;
}

function editMatchMatchday(data, matchId, newMatchday) {
  const m = data.matches.find(x => x.id === matchId);
  if (!m) return false;
  m.matchday = newMatchday || null;
  return true;
}

function removeMatchResult(data, matchId) {
  const idx = data.matches.findIndex(x => x.id === matchId);
  if (idx === -1) return false;
  data.matches.splice(idx, 1);
  recalculateAllStats(data);
  return true;
}

// Repairs matches that were saved with no matchday number. Sets every unmatchdayed
// result to the given matchday, then recomputes standings snapshots so movement graphs
// reflect the repaired data too.
function assignMatchdayToUnset(data, matchday) {
  let count = 0;
  data.matches.forEach(m => {
    if (!m.matchday) {
      m.matchday = matchday;
      count++;
    }
  });
  if (count > 0) {
    data.teams.forEach(t => { t.history = []; });
    const matchdaysInOrder = [...new Set(data.matches.map(m => m.matchday).filter(Boolean))].sort((a, b) => a - b);
    matchdaysInOrder.forEach(md => {
      const stillPending = data.fixtures.some(f => f.matchday === md);
      if (!stillPending) maybeSnapshotCompletedMatchday(data, md);
    });
  }
  return count;
}

function recalculateAllStats(data) {
  data.teams.forEach(t => {
    t.played = 0; t.w = 0; t.d = 0; t.l = 0; t.gf = 0; t.ga = 0; t.pts = 0;
    t.form = [];
  });
  const teamById = Object.fromEntries(data.teams.map(t => [t.id, t]));

  const chronological = [...data.matches].sort((x, y) => x.ts - y.ts);

  chronological.forEach(m => {
    const a = teamById[m.teamAId];
    const b = teamById[m.teamBId];
    if (!a || !b) return;

    a.played++; b.played++;
    a.gf += m.scoreA; a.ga += m.scoreB;
    b.gf += m.scoreB; b.ga += m.scoreA;

    if (m.scoreA > m.scoreB) {
      a.w++; a.pts += 3; b.l++;
      a.form.push('W'); b.form.push('L');
    } else if (m.scoreA < m.scoreB) {
      b.w++; b.pts += 3; a.l++;
      a.form.push('L'); b.form.push('W');
    } else {
      a.d++; b.d++; a.pts += 1; b.pts += 1;
      a.form.push('D'); b.form.push('D');
    }
  });

  data.teams.forEach(t => { t.form = t.form.slice(-5); });
}

// Snapshot every team's current table position, but only once a given matchday's
// fixtures have ALL been played (i.e. no fixtures with that matchday number remain).
function maybeSnapshotCompletedMatchday(data, matchday) {
  if (!matchday) return;
  const stillPending = data.fixtures.some(f => f.matchday === matchday);
  if (stillPending) return;

  const sorted = sortTeams(data.teams);
  sorted.forEach((t, i) => {
    const team = data.teams.find(x => x.id === t.id);
    if (!team) return;
    if (!Array.isArray(team.history)) team.history = [];
    const alreadyRecorded = team.history.some(h => h.matchday === matchday);
    if (alreadyRecorded) return;
    team.history.push({ matchday, position: i + 1 });
    team.history.sort((a, b) => a.matchday - b.matchday);
    if (team.history.length > 40) team.history = team.history.slice(-40);
  });
}

function resetSeason(data) {
  data.teams.forEach(t => {
    t.played = 0; t.w = 0; t.d = 0; t.l = 0; t.gf = 0; t.ga = 0; t.pts = 0;
    t.form = []; t.history = [];
  });
  data.matches = [];
  data.matchdayCounter = 1;
}

function clearAllTeams(data) {
  data.teams = [];
  data.matches = [];
  data.fixtures = [];
}

// ---- fixtures ----
function addFixture(data, teamAId, teamBId, kickoffISO, matchday) {
  if (teamAId === teamBId) return false;
  const a = data.teams.find(t => t.id === teamAId);
  const b = data.teams.find(t => t.id === teamBId);
  if (!a || !b) return false;
  data.fixtures.push({
    id: uid(), teamAId, teamBId,
    kickoff: kickoffISO || null,
    matchday: matchday || null
  });
  data.fixtures.sort((x, y) => {
    if (!x.kickoff && !y.kickoff) return 0;
    if (!x.kickoff) return 1;
    if (!y.kickoff) return -1;
    return new Date(x.kickoff) - new Date(y.kickoff);
  });
  return true;
}

function editFixture(data, fixtureId, kickoffISO, matchday) {
  const f = data.fixtures.find(x => x.id === fixtureId);
  if (!f) return false;
  f.kickoff = kickoffISO || null;
  f.matchday = matchday || null;
  data.fixtures.sort((x, y) => {
    if (!x.kickoff && !y.kickoff) return 0;
    if (!x.kickoff) return 1;
    if (!y.kickoff) return -1;
    return new Date(x.kickoff) - new Date(y.kickoff);
  });
  return true;
}

function removeFixture(data, fixtureId) {
  const idx = data.fixtures.findIndex(f => f.id === fixtureId);
  if (idx === -1) return false;
  data.fixtures.splice(idx, 1);
  return true;
}

function recordResultAndClearFixture(data, fixtureId, scoreA, scoreB) {
  const f = data.fixtures.find(x => x.id === fixtureId);
  if (!f) return false;
  const ok = recordResult(data, f.teamAId, scoreA, f.teamBId, scoreB, f.matchday);
  if (!ok) return false;
  removeFixture(data, fixtureId);
  return true;
}

// ---- announcements ----
function addAnnouncement(data, text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return false;
  data.announcements.unshift({ id: uid(), text: trimmed, ts: Date.now() });
  return true;
}

function removeAnnouncement(data, id) {
  const idx = data.announcements.findIndex(a => a.id === id);
  if (idx === -1) return false;
  data.announcements.splice(idx, 1);
  return true;
}

// ---- about ----
function setAbout(data, text) {
  data.about = text || "";
  return true;
}

// ---- derived views ----
function topScorers(data, count) {
  return [...data.teams]
    .sort((a, b) => b.gf - a.gf)
    .slice(0, count || 3);
}

function teamMatches(data, teamId) {
  return data.matches.filter(m => m.teamAId === teamId || m.teamBId === teamId);
}

function teamFixtures(data, teamId) {
  return data.fixtures.filter(f => f.teamAId === teamId || f.teamBId === teamId);
}

// ---- fixture comparison stats ----

// Head-to-head: every past match between these two teams, regardless of who was home/away.
function headToHeadMatches(data, teamAId, teamBId) {
  return data.matches.filter(m =>
    (m.teamAId === teamAId && m.teamBId === teamBId) ||
    (m.teamAId === teamBId && m.teamBId === teamAId)
  );
}

// Summarizes head-to-head results from teamAId's perspective.
function headToHeadSummary(data, teamAId, teamBId) {
  const matches = headToHeadMatches(data, teamAId, teamBId);
  let winsA = 0, winsB = 0, draws = 0;
  let highestWin = null; // { winnerId, scoreFor, scoreAgainst, ts }

  matches.forEach(m => {
    const aIsTeamA = m.teamAId === teamAId;
    const scoreForA = aIsTeamA ? m.scoreA : m.scoreB;
    const scoreForB = aIsTeamA ? m.scoreB : m.scoreA;

    if (scoreForA > scoreForB) winsA++;
    else if (scoreForB > scoreForA) winsB++;
    else draws++;

    const margin = Math.abs(scoreForA - scoreForB);
    if (margin > 0) {
      const winnerId = scoreForA > scoreForB ? teamAId : teamBId;
      const winnerScore = Math.max(scoreForA, scoreForB);
      const loserScore = Math.min(scoreForA, scoreForB);
      if (!highestWin || margin > (highestWin.scoreFor - highestWin.scoreAgainst)) {
        highestWin = { winnerId, scoreFor: winnerScore, scoreAgainst: loserScore, ts: m.ts };
      }
    }
  });

  return { winsA, winsB, draws, totalMatches: matches.length, highestWin };
}

// Form percentage from a team's last 5 results: W=3pts, D=1pt, L=0, out of max 15.
function formPercent(team) {
  if (!team.form || team.form.length === 0) return 0;
  const points = team.form.reduce((sum, r) => sum + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
  const maxPossible = team.form.length * 3;
  return Math.round((points / maxPossible) * 100);
}

// Season averages per match played: points per game and goals scored per game.
function seasonAverages(team) {
  if (!team.played || team.played === 0) return { pointsPerGame: 0, goalsPerGame: 0 };
  return {
    pointsPerGame: Math.round((team.pts / team.played) * 10) / 10,
    goalsPerGame: Math.round((team.gf / team.played) * 10) / 10
  };
}

// Returns a team's most recent 5 matches (opponent, score, W/D/L, home/away) for the "Last 5" strip.
function recentMatchSummaries(data, teamId, count) {
  const matches = teamMatches(data, teamId)
    .slice()
    .slice(0, count || 5);

  const teamMap = Object.fromEntries(data.teams.map(t => [t.id, t]));

  return matches.map(m => {
    const isHome = m.teamAId === teamId;
    const opponentId = isHome ? m.teamBId : m.teamAId;
    const opponent = teamMap[opponentId];
    const scoreFor = isHome ? m.scoreA : m.scoreB;
    const scoreAgainst = isHome ? m.scoreB : m.scoreA;
    const result = scoreFor > scoreAgainst ? 'W' : scoreFor < scoreAgainst ? 'L' : 'D';
    return {
      opponentName: opponent ? opponent.name : 'Unknown',
      isHome,
      scoreFor,
      scoreAgainst,
      result,
      ts: m.ts
    };
  });
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = 60000, hr = 3600000, day = 86400000;
  if (diff < min) return "just now";
  if (diff < hr) return Math.floor(diff / min) + "m ago";
  if (diff < day) return Math.floor(diff / hr) + "h ago";
  return Math.floor(diff / day) + "d ago";
}

function formatKickoff(iso) {
  if (!iso) return "Time TBC";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "Time TBC";
  const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${dateStr} · ${timeStr}`;
}
