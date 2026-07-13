// data.js — shared cloud storage via JSONBin.io
// Used by index.html, admin.html, team.html

const JSONBIN_BIN_ID = "6a4f8f67f5f4af5e297729db";
const JSONBIN_API_KEY = "$2a$10$1YKDZY/xBG8zmm8plP.JvuExTB.4vK1B4fywqF7suieQOMYoocmKW";
const JSONBIN_BASE = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

const ADMIN_PASSWORD = "dlsboss2026";
const ADMIN_SESSION_KEY = "dls_admin_unlocked_session";

function emptyState() {
  return {
    teams: [],          // { id, name, logo, played, w, d, l, gf, ga, pts, form:[], history:[] }
    matches: [],         // { id, teamAId, teamBId, scoreA, scoreB, ts, matchday }
    fixtures: [],         // { id, teamAId, teamBId, kickoff (ISO string), matchday }
    announcements: [],     // { id, text, ts }
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
    form: [],       // array of 'W' | 'D' | 'L', most recent last
    history: []      // array of { ts, position } snapshots for the movement graph
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
  recordStandingsSnapshot(data);
  return true;
}

function editMatchResult(data, matchId, newScoreA, newScoreB) {
  const m = data.matches.find(x => x.id === matchId);
  if (!m) return false;
  m.scoreA = newScoreA;
  m.scoreB = newScoreB;
  // ts is untouched on purpose — editing a result must not change when it was played
  recalculateAllStats(data);
  recordStandingsSnapshot(data);
  return true;
}

function recalculateAllStats(data) {
  // reset every team's stats, then replay full match history to rebuild them.
  data.teams.forEach(t => {
    t.played = 0; t.w = 0; t.d = 0; t.l = 0; t.gf = 0; t.ga = 0; t.pts = 0;
    t.form = [];
  });
  const teamById = Object.fromEntries(data.teams.map(t => [t.id, t]));

  // replay oldest-first so it doesn't matter that matches[] is stored newest-first
  const chronological = [...data.matches].sort((x, y) => x.ts - y.ts);

  chronological.forEach(m => {
    const a = teamById[m.teamAId];
    const b = teamById[m.teamBId];
    if (!a || !b) return; // team was removed since — skip safely

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

  // keep only the last 5 results for the form strip
  data.teams.forEach(t => { t.form = t.form.slice(-5); });
}

// Snapshot every team's current table position, so team.html can plot movement over time.
function recordStandingsSnapshot(data) {
  const sorted = sortTeams(data.teams);
  const ts = Date.now();
  sorted.forEach((t, i) => {
    const team = data.teams.find(x => x.id === t.id);
    if (!team) return;
    if (!Array.isArray(team.history)) team.history = [];
    team.history.push({ ts, position: i + 1 });
    // cap history length so storage doesn't grow forever
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
  // fixtures sorted by kickoff time, undated ones last
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

// Records a result AND clears the matching fixture (if one exists) in one step —
// this is what admin's "log result" flow should call when the result comes from a fixture.
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
