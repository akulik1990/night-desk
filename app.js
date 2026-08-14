"use strict";
const GHOST = "Ghost";
const STORE = "night-desk-v1";
const $ = (s) => document.querySelector(s);

let state = { phase: "setup", players: [], nights: [], votes: {} };
let lastFocusKey = null;
let summaryOpen = null;

function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n[k] = v;
  }
  for (const kid of kids.flat()) {
    if (kid == null) continue;
    n.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
  }
  return n;
}

const roll = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
const shuffled = (xs) => xs
  .map((v) => [crypto.getRandomValues(new Uint32Array(1))[0], v])
  .sort((a, b) => a[0] - b[0])
  .map((pair) => pair[1]);

const parseNames = (raw) => raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

function validateNames(names) {
  const lower = names.map((s) => s.toLowerCase());
  const dupes = names.filter((_, i) => lower.indexOf(lower[i]) !== i);
  if (dupes.length) throw new Error("repeated: " + dupes.join(", "));
  if (names.length < 13 || names.length > 15)
    throw new Error("need 13 to 15 on the roster, not " + names.length);
}

function ghostSeats(count) {
  const seats = new Set();
  if (count && roll(2)) seats.add(4 + roll(3));
  const spare = shuffled([7, 8, 9, 10, 11, 12, 13, 14, 15]);
  while (seats.size < count) seats.add(spare.pop());
  return seats;
}

function deal(names) {
  const ghosts = ghostSeats(15 - names.length);
  const q = shuffled(names);
  return Array.from({ length: 15 }, (_, i) => {
    const pos = i + 1;
    return ghosts.has(pos)
      ? { pos, name: GHOST, ghost: true }
      : { pos, name: q.pop(), ghost: false };
  });
}

const roleOf = (p) =>
  p.pos <= 3 ? "Mafia" : p.pos === 4 ? "Cop" : p.pos === 5 ? "Medic" : p.pos === 6 ? "Vigi" : "Town";
const alignOf = (p) => (p.pos <= 3 ? "Mafia" : "Town");
const byName = (name) => state.players.find((p) => p.name === name);
const special = (pos) => state.players.find((p) => p.pos === pos);
const ghostCount = () => state.players.filter((p) => p.ghost).length;
const n0Kp = () => Math.max(0, 2 - ghostCount());
const killPoints = (nd, mafiaAlive) =>
  nd.night === 0 ? n0Kp() : mafiaAlive === 3 ? 2 : 1;

function vigiUsedBefore(n) {
  return state.nights.some((x) => x.night < n && x.vigi);
}

function acting(pos, dead) {
  const p = special(pos);
  return !p.ghost && !dead.has(p.name);
}

function resolveNight(nd, before) {
  const shots = [...nd.kills];
  if (nd.vigi && acting(6, before) && !vigiUsedBefore(nd.night)) shots.push(nd.vigi);
  const hits = shots.filter((n) => n && !before.has(n));
  const blocked = nd.medic && acting(5, before) ? hits.indexOf(nd.medic) : -1;
  if (blocked >= 0) hits.splice(blocked, 1);
  return [...new Set(hits)];
}

function timeline() {
  const dead = new Set();
  const beforeDay = {}, beforeNight = {}, deaths = {};
  const maxN = state.nights.length ? state.nights[state.nights.length - 1].night : -1;
  for (let n = 0; n <= maxN; n++) {
    beforeDay[n] = new Set(dead);
    if (n >= 1 && state.votes[n]) dead.add(state.votes[n]);
    beforeNight[n] = new Set(dead);
    const nd = state.nights.find((x) => x.night === n);
    if (nd && !winnerAt(beforeNight[n])) {
      deaths[n] = resolveNight(nd, beforeNight[n]);
      if (n === 0)
        deaths[n] = [...state.players.filter((p) => p.ghost).map((p) => p.name), ...deaths[n]];
      deaths[n].forEach((d) => dead.add(d));
    } else {
      deaths[n] = [];
    }
  }
  return { beforeDay, beforeNight, deaths, dead };
}

function winnerAt(dead) {
  const alive = (f) => state.players.filter((p) => !p.ghost && f(p) && !dead.has(p.name)).length;
  const m = alive((p) => alignOf(p) === "Mafia");
  const t = alive((p) => alignOf(p) === "Town");
  if (m === 0) return "Town";
  if (m >= t) return "Mafia";
  return null;
}

function fixState() {
  for (let pass = 0; pass < 10; pass++) {
    const t = timeline();
    let changed = false;
    const aliveReal = (dead) => state.players.filter((p) => !p.ghost && !dead.has(p.name));
    for (const nd of state.nights) {
      const before = t.beforeNight[nd.night];
      if (winnerAt(before)) {
        if (nd.kills[0] || nd.kills[1] || nd.cop || nd.medic || nd.vigi) {
          nd.kills = ["", ""]; nd.cop = ""; nd.medic = ""; nd.vigi = "";
          changed = true;
        }
        continue;
      }
      const ok = new Set(aliveReal(before).map((p) => p.name));
      const legalTarget = (name, actorPos) => {
        if (!name || !ok.has(name)) return false;
        return !actorPos || special(actorPos).name !== name;
      };
      const mafiaAlive = aliveReal(before).filter((p) => alignOf(p) === "Mafia").length;
      const kp = killPoints(nd, mafiaAlive);
      nd.kills = nd.kills.map((k, i) => {
        const legal = k && ok.has(k) && alignOf(byName(k)) === "Town" && i < kp;
        if (k && !legal) changed = true;
        return legal ? k : "";
      });
      if (nd.cop && (!acting(4, before) || !legalTarget(nd.cop, 4))) { nd.cop = ""; changed = true; }
      if (nd.medic && (!acting(5, before) || !legalTarget(nd.medic, 5) || (nd.night === 0 && kp === 0))) {
        nd.medic = ""; changed = true;
      }
      if (nd.vigi && (!acting(6, before) || vigiUsedBefore(nd.night) || !legalTarget(nd.vigi, 6))) {
        nd.vigi = ""; changed = true;
      }
    }
    for (const [d, v] of Object.entries(state.votes)) {
      if (v && (!byName(v) || byName(v).ghost || t.beforeDay[d]?.has(v))) {
        state.votes[d] = ""; changed = true;
      }
    }
    if (!changed) return t;
  }
  return timeline();
}

function revealText() {
  const mafia = state.players.filter((p) => p.pos <= 3).map((p) => p.name);
  return [
    `Mafia: ||${mafia.join(", ")}||`,
    `Cop: ||${special(4).name}||`,
    `Medic: ||${special(5).name}||`,
    `Vigi: ||${special(6).name}||`,
  ].join("\n");
}

function copResult(nd) {
  if (!nd.cop || nd.night === 0) return null;
  const prior = state.nights.filter((x) => x.night < nd.night && x.cop).at(-1);
  if (!prior) return null;
  const to = prior.cop;
  const verdict = alignOf(byName(nd.cop)) === alignOf(byName(to)) ? "SAME" : "DIFFERENT";
  return { verdict, to };
}

function nightText(nd, t) {
  const lines = [];
  if (nd.night >= 1 && !winnerAt(t.beforeDay[nd.night])) {
    const v = state.votes[nd.night];
    lines.push(`=== Day ${nd.night} ===`, v ? `lynched ${v}` : "no lynch");
  }
  lines.push(`=== Night ${nd.night} Actions ===`);
  const kills = [...new Set(nd.kills.filter(Boolean))];
  if (kills.length) lines.push(`mafia: ||killed ${kills.join(", ")}||`);
  if (nd.cop) {
    const r = copResult(nd);
    lines.push(r ? `cop: ||check ${nd.cop} - ${r.verdict} to ${r.to}||` : `cop: ||check ${nd.cop}||`);
  }
  if (nd.medic) lines.push(`medic: ||saved ${nd.medic}||`);
  const armed = acting(6, t.beforeNight[nd.night]) && !vigiUsedBefore(nd.night);
  if (nd.vigi) lines.push(`vigi: ||shot ${nd.vigi}||`);
  else if (armed) lines.push(`vigi: ||holstered||`);
  if (nd.rng[0] != null && nd.rng[1] != null) lines.push(`D${nd.night + 1} rngs: ${nd.rng[0] + nd.rng[1]}`);
  return lines.join("\n");
}

function copText(nd) {
  if (!nd.cop) return "";
  const r = copResult(nd);
  return `N${nd.night} cop: ` + (r
    ? `${nd.cop} is ${r.verdict === "SAME" ? "same as" : "different from"} ${r.to}`
    : `${nd.cop}, first check`);
}

function modText(nd, t) {
  const d = [...t.deaths[nd.night]].sort();
  return `N${nd.night} down: ` + (d.length ? d.join(", ") : "nobody");
}

function summaryText(t) {
  const mafia = state.players.filter((p) => p.pos <= 3).map((p) => p.name).join(", ");
  const winner = winnerAt(t.dead);
  const sections = [
    [winner ? `**${winner.toUpperCase()} WINS**` : "**GAME IN PROGRESS**"],
    ["**Players**", ...state.players.map((p) => `${p.pos}. ${p.name}`)],
    ["**Reveal**",
      `Mafia: ${mafia}`,
      `Cop: ${special(4).name}`,
      `Medic: ${special(5).name}`,
      `Vigi: ${special(6).name}`],
  ];
  for (const nd of state.nights) {
    if (winnerAt(t.beforeDay[nd.night])) continue;
    if (winnerAt(t.beforeNight[nd.night])) {
      const v = state.votes[nd.night];
      sections.push([`=== Day ${nd.night} ===`, v ? `lynched ${v}` : "no lynch"]);
    } else {
      sections.push([nightText(nd, t)]);
    }
  }
  return sections.map((s) => s.join("\n")).join("\n\n");
}

function statsText(t) {
  const died = t.deaths[0] ? [...t.deaths[0]].sort() : [];
  const winner = winnerAt(t.dead);
  return [
    ...state.players.map((p) => p.name),
    "",
    `N0: ${died.length ? died.join(", ") : "none"}`,
    "",
    winner ? `${winner} Win` : "? Win",
  ].join("\n");
}

function incText(nd, t) {
  const before = t.beforeNight[nd.night];
  if (winnerAt(before)) return "";
  const aliveReal = state.players.filter((p) => !p.ghost && !before.has(p.name));
  const mafiaAlive = aliveReal.filter((p) => alignOf(p) === "Mafia").length;
  const kp = killPoints(nd, mafiaAlive);
  const missing = [];
  if (kp >= 1 && !nd.kills[0]) missing.push("kill");
  if (kp >= 2 && !nd.kills[1]) missing.push("kill 2");
  if (acting(4, before) && !nd.cop) missing.push("cop");
  if (kp >= 1 && acting(5, before) && !nd.medic) missing.push("medic");
  return missing.length ? `missing: ${missing.join(", ")}` : "";
}

function renamePlayer(p) {
  const cur = p.name;
  const input = prompt(`Rename ${cur}:`, cur);
  if (input == null) return;
  const n = input.trim();
  if (!n || n === cur) return;
  if (n.toLowerCase() === GHOST.toLowerCase() ||
      state.players.some((x) => x !== p && x.name.toLowerCase() === n.toLowerCase())) {
    alert(`"${n}" is already taken.`);
    return;
  }
  p.name = n;
  for (const nd of state.nights) {
    nd.kills = nd.kills.map((k) => (k === cur ? n : k));
    if (nd.cop === cur) nd.cop = n;
    if (nd.medic === cur) nd.medic = n;
    if (nd.vigi === cur) nd.vigi = n;
  }
  for (const d of Object.keys(state.votes))
    if (state.votes[d] === cur) state.votes[d] = n;
  renderPlay();
}

function tagFor(p) {
  const role = roleOf(p);
  if (p.ghost) return h("span", { class: "tag" }, role === "Town" ? "ghost" : `ghost - ${role.toLowerCase()}`);
  if (role === "Town") return null;
  return h("span", { class: "tag " + role.toLowerCase() }, role);
}

function mkSelect(options, current, placeholder, onchange, key) {
  const sel = h("select", { onchange: (e) => { lastFocusKey = key; onchange(e.target.value); } },
    h("option", { value: "" }, placeholder),
    options.map((name) => h("option", { value: name }, name)));
  if (key) sel.dataset.key = key;
  sel.value = current || "";
  return sel;
}

function wireCopy(b, getText) {
  b.addEventListener("click", () => {
    navigator.clipboard.writeText(getText()).then(() => {
      b.textContent = "Copied";
      b.classList.add("done");
      setTimeout(() => { b.textContent = "Copy"; b.classList.remove("done"); }, 1500);
    });
  });
}

function copyBtn(getText) {
  const b = h("button", { class: "btn-copy" }, "Copy");
  wireCopy(b, getText);
  return b;
}

wireCopy($('[data-copy="reveal-pre"]'), () => $("#reveal-pre").textContent);

function pasteBlock(label, text, preId) {
  return h("div", { class: "paste" },
    h("div", { class: "head" }, h("span", {}, label),
      copyBtn(() => document.getElementById(preId).textContent)),
    h("pre", { id: preId }, text));
}

function renderRoster(dead, marks) {
  const ol = $("#roster");
  if (ol.children.length !== state.players.length) {
    ol.replaceChildren(...state.players.map((p) =>
      h("li", {},
        h("span", { class: "pos" }, String(p.pos)),
        h("span", { class: "name", onclick: () => { if (!p.ghost) renamePlayer(p); } }, p.name),
        h("span", { class: "died" }),
        tagFor(p))));
  }
  state.players.forEach((p, i) => {
    ol.children[i].className =
      (dead.has(p.name) ? "dead " : "") + (p.ghost ? "ghostrow" : "");
    ol.children[i].querySelector(".name").textContent = p.name;
    ol.children[i].querySelector(".died").textContent = marks.get(p.name) || "";
  });
}

function fieldRow(labelText, control, extra) {
  return h("div", { class: "field" }, h("label", {}, labelText), control, extra);
}

function buildRngKids(nd) {
  const slot = (i) => {
    if (nd.rng[i] != null) return h("span", { class: "rngval" }, String(nd.rng[i]));
    return h("button", { class: "btn sm", onclick: () => {
      nd.rng[i] = i === 1 ? roll(2) : (roll(3) ? 1 : 0);
      update(`night-${nd.night}`);
    } }, "Roll");
  };
  const total = nd.rng[0] != null && nd.rng[1] != null ? String(nd.rng[0] + nd.rng[1]) : "?";
  return [slot(0), h("span", {}, "+"), slot(1), h("span", {}, "="),
    h("span", { class: "rngval" }, total)];
}

function renderNight(nd, t) {
  const card = h("div", { class: "card", id: `night-${nd.night}` },
    h("h3", {}, `Night ${nd.night}`,
      h("span", { class: "inc", id: `inc-${nd.night}` }, incText(nd, t))));
  const before = t.beforeNight[nd.night];

  if (winnerAt(before)) {
    card.appendChild(h("p", { class: "decided" }, "Game was decided before this night."));
    return card;
  }

  const aliveReal = state.players.filter((p) => !p.ghost && !before.has(p.name));
  const names = (f) => aliveReal.filter(f).map((p) => p.name);
  const set = (key, i) => (v) => {
    if (i == null) nd[key] = v; else nd.kills[i] = v;
    update(`night-${nd.night}`);
  };

  const mafiaAlive = aliveReal.filter((p) => alignOf(p) === "Mafia").length;
  const kp = killPoints(nd, mafiaAlive);
  if (kp >= 1)
    card.appendChild(fieldRow(kp === 1 ? "Mafia kill (1 KP)" : "Mafia kill 1",
      mkSelect(names((p) => alignOf(p) === "Town"), nd.kills[0], "no kill", set("kills", 0), `n${nd.night}-kill0`)));
  if (kp >= 2)
    card.appendChild(fieldRow("Mafia kill 2",
      mkSelect(names((p) => alignOf(p) === "Town"), nd.kills[1], "no kill", set("kills", 1), `n${nd.night}-kill1`)));

  const lockedNote = (label, text) =>
    card.appendChild(fieldRow(label, h("span", { class: "note" }, text)));

  const roleField = (pos, label, build) => {
    const p = special(pos);
    if (p.ghost) return;
    if (before.has(p.name)) lockedNote(label, `${p.name} is dead`);
    else build();
  };

  roleField(4, "Cop check", () => {
    const r = copResult(nd);
    card.appendChild(fieldRow("Cop check",
      mkSelect(names((p) => p.pos !== 4), nd.cop, "no check", set("cop"), `n${nd.night}-cop`),
      h("span", { class: "badge" + (r ? " " + r.verdict.toLowerCase() : " hidden"),
        id: `copbadge-${nd.night}` }, r ? r.verdict : "")));
  });
  roleField(5, "Medic save", () => {
    if (nd.night === 0 && kp === 0) return;
    card.appendChild(fieldRow("Medic save",
      mkSelect(names((p) => p.pos !== 5), nd.medic, "no save", set("medic"), `n${nd.night}-medic`)));
  });
  roleField(6, "Vigi", () => {
    if (vigiUsedBefore(nd.night)) lockedNote("Vigi", "shot already spent");
    else
      card.appendChild(fieldRow("Vigi",
        mkSelect(names((p) => p.pos !== 6), nd.vigi, "holster", set("vigi"), `n${nd.night}-vigi`)));
  });

  card.appendChild(fieldRow(`Formals (Day ${nd.night + 1})`,
    h("div", { class: "rngrow", id: `rng-${nd.night}` }, buildRngKids(nd))));

  const cop = pasteBlock("cop check", copText(nd), `cop-${nd.night}`);
  cop.classList.toggle("hidden", !nd.cop);
  card.appendChild(cop);
  card.appendChild(pasteBlock(`Night ${nd.night} — discord`, nightText(nd, t), `out-${nd.night}`));
  card.appendChild(pasteBlock("mod only", modText(nd, t), `mod-${nd.night}`));
  return card;
}

function patchNight(nd, t) {
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set(`cop-${nd.night}`, copText(nd));
  set(`out-${nd.night}`, nightText(nd, t));
  set(`mod-${nd.night}`, modText(nd, t));
  const cop = document.getElementById(`cop-${nd.night}`);
  if (cop) cop.parentElement.classList.toggle("hidden", !nd.cop);
  set(`inc-${nd.night}`, incText(nd, t));
  const badge = document.getElementById(`copbadge-${nd.night}`);
  if (badge) {
    const r = copResult(nd);
    badge.textContent = r ? r.verdict : "";
    badge.className = "badge" + (r ? " " + r.verdict.toLowerCase() : " hidden");
  }
  const rng = document.getElementById(`rng-${nd.night}`);
  if (rng) rng.replaceChildren(...buildRngKids(nd));
}

function buildDayBlock(nd, t) {
  const wrap = h("div", { id: `day-${nd.night}` },
    h("div", { class: "day-strip" }, `Day ${nd.night}`));
  const before = t.beforeDay[nd.night];
  if (winnerAt(before)) {
    wrap.appendChild(h("p", { class: "decided" }, "Game was decided before this day."));
  } else {
    const alive = state.players.filter((p) => !p.ghost && !before.has(p.name)).map((p) => p.name);
    wrap.appendChild(h("div", { class: "card" },
      fieldRow("Voted out",
        mkSelect(alive, state.votes[nd.night], "no one",
          (v) => { state.votes[nd.night] = v; update(`day-${nd.night}`); }, `d${nd.night}-vote`))));
  }
  return wrap;
}

function renderPlay(keepId) {
  const y = window.scrollY;
  const t = fixState();

  const marks = new Map();
  for (const [d, v] of Object.entries(state.votes)) if (v) marks.set(v, `†D${d}`);
  for (const [n, deaths] of Object.entries(t.deaths))
    for (const name of deaths) marks.set(name, `†N${n}`);
  renderRoster(t.dead, marks);
  $("#reveal-pre").textContent = revealText();

  const winner = winnerAt(t.dead);
  $("#winbox").replaceChildren(winner
    ? h("div", { class: "winbanner " + winner }, `${winner.toUpperCase()} WINS`)
    : "");
  $("#btn-summary").classList.remove("hidden");
  $("#btn-stats").classList.remove("hidden");
  $("#rostercard").classList.toggle("hidden", !!summaryOpen);
  $("#summarybox").replaceChildren(...(summaryOpen
    ? [h("div", { class: "card", style: "margin-top:0.5rem" },
        pasteBlock(summaryOpen,
          summaryOpen === "full" ? summaryText(t) : statsText(t), "summary-pre"))]
    : []));

  $("#stats").classList.remove("hidden");
  const aliveNow = state.players.filter((p) => !p.ghost && !t.dead.has(p.name));
  const mafNow = aliveNow.filter((p) => alignOf(p) === "Mafia").length;
  const totalNow = aliveNow.length;
  $("#st-town").textContent = totalNow - mafNow;
  $("#st-maf").textContent = mafNow;
  $("#st-total").textContent = totalNow;
  $("#st-day").textContent = state.nights.length
    ? Math.max(1, state.nights[state.nights.length - 1].night) : 1;
  $("#st-maj").textContent = Math.floor(totalNow / 2) + 1;

  const log = $("#log");
  const sync = (id, build) => {
    const cur = document.getElementById(id);
    if (!cur) log.appendChild(build());
    else if (id !== keepId) cur.replaceWith(build());
    return id === keepId;
  };
  for (const nd of state.nights) {
    if (nd.night >= 1) sync(`day-${nd.night}`, () => buildDayBlock(nd, t));
    if (sync(`night-${nd.night}`, () => renderNight(nd, t))) patchNight(nd, t);
  }

  const next = state.nights.length ? state.nights[state.nights.length - 1].night + 1 : 0;
  const btn = $("#btn-next");
  btn.classList.toggle("hidden", !!winner);
  btn.textContent = next === 0 ? "Start Night 0" : `Start Day ${next} & Night ${next}`;

  localStorage.setItem(STORE, JSON.stringify(state));
  window.scrollTo(0, y);
  requestAnimationFrame(() => window.scrollTo(0, y));
}

function update(keepId) {
  setTimeout(() => {
    renderPlay(keepId);
    if (lastFocusKey) {
      const el = document.querySelector(`[data-key="${lastFocusKey}"]`);
      if (el && el !== document.activeElement) el.focus({ preventScroll: true });
    }
  }, 0);
}

let pendingDeal = null;

function renderPreview() {
  $("#preview-list").replaceChildren(...pendingDeal.map((p) =>
    h("li", { class: p.ghost ? "ghostrow" : "" },
      h("span", { class: "pos" }, String(p.pos)),
      h("span", { class: "name" }, p.name),
      tagFor(p))));
  $("#preview").classList.remove("hidden");
}

function seatText(n) {
  const ghosts = n >= 13 && n <= 15 ? 15 - n : 0;
  return `${n} of 15 seats` +
    (ghosts ? `, ${ghosts} ghost${ghosts > 1 ? "s" : ""} filling in` : "");
}

$("#names").addEventListener("input", () => {
  $("#namecount").textContent = seatText(parseNames($("#names").value).length);
});

function doDeal() {
  const err = $("#nameerr");
  err.classList.add("hidden");
  try {
    const names = parseNames($("#names").value);
    validateNames(names);
    pendingDeal = deal(names);
    renderPreview();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove("hidden");
  }
}
$("#btn-rand").addEventListener("click", doDeal);
$("#btn-redeal").addEventListener("click", doDeal);

$("#btn-accept").addEventListener("click", () => {
  state = { phase: "play", players: pendingDeal, nights: [], votes: {} };
  $("#setup").classList.add("hidden");
  $("#play").classList.remove("hidden");
  renderPlay();
});

$("#btn-next").addEventListener("click", () => {
  const t = fixState();
  const problems = state.nights
    .map((nd) => ({ night: nd.night, miss: incText(nd, t) }))
    .filter((x) => x.miss);
  if (problems.length) {
    for (const x of problems)
      document.getElementById(`night-${x.night}`)?.classList.add("bad");
    alert("Finish recording first:\n" +
      problems.map((x) => `Night ${x.night} — ${x.miss}`).join("\n"));
    return;
  }
  const next = state.nights.length ? state.nights[state.nights.length - 1].night + 1 : 0;
  state.nights.push({ night: next, kills: ["", ""], cop: "", medic: "", vigi: "", rng: [null, null] });
  renderPlay();
});

$("#btn-summary").addEventListener("click", () => {
  summaryOpen = summaryOpen === "full" ? null : "full";
  renderPlay();
});

$("#btn-stats").addEventListener("click", () => {
  summaryOpen = summaryOpen === "stats" ? null : "stats";
  renderPlay();
});

$("#btn-newgame").addEventListener("click", () => {
  if (!confirm("Start a new game? The current one is discarded.")) return;
  localStorage.removeItem(STORE);
  state = { phase: "setup", players: [], nights: [], votes: {} };
  pendingDeal = null;
  summaryOpen = null;
  $("#summarybox").replaceChildren();
  $("#btn-summary").classList.add("hidden");
  $("#btn-stats").classList.add("hidden");
  $("#names").value = "";
  $("#namecount").textContent = seatText(0);
  $("#nameerr").classList.add("hidden");
  $("#preview").classList.add("hidden");
  $("#preview-list").replaceChildren();
  $("#roster").replaceChildren();
  $("#log").replaceChildren();
  $("#winbox").replaceChildren();
  $("#play").classList.add("hidden");
  $("#stats").classList.add("hidden");
  $("#setup").classList.remove("hidden");
  window.scrollTo(0, 0);
});

function setPref(kind, value) {
  document.documentElement.dataset[kind] = value;
  localStorage.setItem(`night-desk-${kind}`, value);
}

for (const kind of ["theme", "font"]) {
  const sel = $("#" + kind);
  sel.value = localStorage.getItem(`night-desk-${kind}`) || sel.options[0].value;
  setPref(kind, sel.value);
  sel.addEventListener("change", () => setPref(kind, sel.value));
}

const settings = $(".settings");
document.addEventListener("click", (e) => {
  if (settings.open && !settings.contains(e.target)) settings.open = false;
});

function mastHeight() {
  document.documentElement.style.setProperty("--mast", $("header").offsetHeight + "px");
}
addEventListener("resize", mastHeight);
mastHeight();

function selftest() {
  let bad = 0;
  const ok = (cond, what) => { if (!cond) { bad++; console.error("selftest:", what); } };

  for (let players = 13; players <= 15; players++) {
    const names = Array.from({ length: players }, (_, i) => "P" + i);
    for (let run = 0; run < 400; run++) {
      const seats = deal(names);
      const g = seats.filter((p) => p.ghost);
      ok(seats.length === 15, "seat count");
      ok(g.length === 15 - players, "ghost count");
      ok(!g.some((p) => p.pos <= 3), "ghost dealt into the mafia block");
      ok(g.filter((p) => p.pos <= 6).length <= 1, "two ghosts in seats 4-6");
      ok(new Set(seats.filter((p) => !p.ghost).map((p) => p.name)).size === players,
         "lost or duplicated a name");
    }
  }

  const keep = state;
  state = { phase: "play", players: deal(Array.from({ length: 15 }, (_, i) => "P" + i)),
            nights: [], votes: {} };
  const nm = (pos) => special(pos).name;
  const night = (over) => resolveNight(
    { night: 1, kills: ["", ""], cop: "", medic: "", vigi: "", ...over }, new Set());
  ok(night({ kills: [nm(7), ""] }).join() === nm(7), "plain kill");
  ok(night({ kills: [nm(7), ""], medic: nm(7) }).length === 0, "medic save");
  ok(night({ kills: [nm(7), nm(7)], medic: nm(7) }).join() === nm(7), "double kill beats one save");
  ok(night({ kills: [nm(7), ""], vigi: nm(8) }).sort().join() === [nm(7), nm(8)].sort().join(),
     "vigi adds a kill");
  ok(night({ medic: nm(8) }).length === 0, "save on an untouched player");
  state = keep;

  const probe = (kind, vars) => {
    const was = document.documentElement.dataset[kind];
    const seen = new Map();
    for (const opt of $("#" + kind).options) {
      document.documentElement.dataset[kind] = opt.value;
      const css = getComputedStyle(document.documentElement);
      const swatch = vars.map((v) => css.getPropertyValue(v).trim());
      swatch.forEach((val, i) => ok(val, `${opt.value} is missing ${vars[i]}`));
      const key = swatch.join("|");
      ok(!seen.has(key), `${opt.value} is identical to ${seen.get(key)}`);
      seen.set(key, opt.value);
    }
    document.documentElement.dataset[kind] = was;
  };
  probe("theme", ["--ink", "--panel", "--panel2", "--line", "--text",
                  "--muted", "--accent", "--maf", "--town", "--ghost", "--good"]);
  probe("font", ["--serif", "--sans", "--mono"]);

  console.log(bad ? `selftest: ${bad} failed` : "selftest: clean");
  return bad === 0;
}
if (location.search.includes("selftest")) selftest();

try {
  const saved = JSON.parse(localStorage.getItem(STORE));
  if (saved && saved.phase === "play" && Array.isArray(saved.players) && saved.players.length) {
    state = saved;
    $("#setup").classList.add("hidden");
    $("#play").classList.remove("hidden");
    renderPlay();
  }
} catch (e) {}
