// data.js — shared cloud storage via JSONBin.io
// Used by index.html and admin.html

const JSONBIN_BIN_ID = "6a4f8f67f5f4af5e297729db";
const JSONBIN_API_KEY = "$2a$10$1YKDZY/xBG8zmm8plP.JvuExTB.4vK1B4fywqF7suieQOMYoocmKW";
const JSONBIN_BASE = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

const ADMIN_PASSWORD = "dlsboss2026";
const ADMIN_SESSION_KEY = "dls_admin_unlocked_session";

function emptyState() {
  return { teams: [], matches: [], announcement: "" };
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
  return {
    teams: Array.isArray(record.teams) ? record.teams : [],
    matches: Array.isArray(record.matches) ? record.matches : [],
    announcement: typeof record.announcement === "string" ? record.announcement : ""
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

function addTeam(data, name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return false;
  if (data.teams.some(t => t.name.toLowerCase() === trimmed.toLowerCase())) return false;
  data.teams.push({
    id: uid(), name: trimmed, logo: null,
    played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0
  });
  return true;
}

function removeTeam(data, id) {
  const idx = data.teams.findIndex(t => t.id === id);
  if (idx === -1) return false;
  data.teams.splice(idx, 1);
  data.matches = data.matches.filter(m => m.teamAId !== id && m.teamBId !== id);
  recalculateAllStats(data);
  return true;
}

function setTeamLogo(data, id, dataUrl) {
  const t = data.teams.find(x => x.id === id);
  if (!t) return false;
  t.logo = dataUrl;
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

function gd(team) {
  return team.gf - team.ga;
}

function recordResult(data, teamAId, scoreA, teamBId, scoreB) {
  if (teamAId === teamBId) return false;
  const a = data.teams.find(t => t.id === teamAId);
  const b = data.teams.find(t => t.id === teamBId);
  if (!a || !b) return false;

  data.matches.unshift({ id: uid(), teamAId, teamBId, scoreA, scoreB, ts: Date.now() });
  recalculateAllStats(data);
  return true;
}

function editMatchResult(data, matchId, newScoreA, newScoreB) {
  const m = data.matches.find(x => x.id === matchId);
  if (!m) return false;
  m.scoreA = newScoreA;
  m.scoreB = newScoreB;
  // ts is untouched on purpose — editing a result must not change when it was played
  recalculateAllStats(data);
  return true;
}

function recalculateAllStats(data) {
  // reset every team's stats, then replay full match history to rebuild them.
  // This keeps edits/removals of any match always consistent, no matter the order.
  data.teams.forEach(t => {
    t.played = 0; t.w = 0; t.d = 0; t.l = 0; t.gf = 0; t.ga = 0; t.pts = 0;
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

    if (m.scoreA > m.scoreB) { a.w++; a.pts += 3; b.l++; }
    else if (m.scoreA < m.scoreB) { b.w++; b.pts += 3; a.l++; }
    else { a.d++; b.d++; a.pts += 1; b.pts += 1; }
  });
}

function resetSeason(data) {
  data.teams.forEach(t => {
    t.played = 0; t.w = 0; t.d = 0; t.l = 0; t.gf = 0; t.ga = 0; t.pts = 0;
  });
  data.matches = [];
}

function clearAllTeams(data) {
  data.teams = [];
  data.matches = [];
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = 60000, hr = 3600000, day = 86400000;
  if (diff < min) return "just now";
  if (diff < hr) return Math.floor(diff / min) + "m ago";
  if (diff < day) return Math.floor(diff / hr) + "h ago";
  return Math.floor(diff / day) + "d ago";
    }
