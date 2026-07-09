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
  return true;
}

function setTeamLogo(data, id, dataUrl) {
  const t = data.teams.find(x => x.id === id);
  if (!t) return false;
  t.logo = dataUrl;
  return true;
}

function recordResult(data, teamAId, scoreA, teamBId, scoreB) {
  if (teamAId === teamBId) return false;
  const a = data.teams.find(t => t.id === teamAId);
  const b = data.teams.find(t => t.id === teamBId);
  if (!a || !b) return false;

  a.played++; b.played++;
  a.gf += scoreA; a.ga += scoreB;
  b.gf += scoreB; b.ga += scoreA;

  if (scoreA > scoreB) { a.w++; a.pts += 3; b.l++; }
  else if (scoreA < scoreB) { b.w++; b.pts += 3; a.l++; }
  else { a.d++; b.d++; a.pts += 1; b.pts += 1; }

  data.matches.unshift({ id: uid(), teamAId, teamBId, scoreA, scoreB, ts: Date.now() });
  return true;
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
