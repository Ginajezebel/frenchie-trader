// Frenchie Trader: reads the paper bot's results from GitHub (results/bot_<day>.log). Display only.
const REPO = "Ginajezebel/scalp-bot";
const KEY = "ft_key";
const TZ = "America/Los_Angeles";
const BOTS = {
  naiya: { name: "Naiya", role: "Old scalper", c: "var(--naiya)" },
  kona: { name: "Kona", role: "New scalper", c: "var(--kona)" },
  eva: { name: "Eva", role: "Bounce bot", c: "var(--eva)" },
  plays: { name: "Plays", role: "SPY · QQQ", c: "var(--plays)" },
};
const $ = (id) => document.getElementById(id);
const fmt = (v) => (v < 0 ? "−$" : "+$") + Math.abs(v).toFixed(2);
const cls = (v) => (v < 0 ? "down" : "up");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let filt = "all", today = null, dayCache = {}, timer = null;
let sel = null, wkOff = 0;            // sel: a past day being looked at (null = today). wkOff: 0 this week, -1 last week...
const FIRST_MON = "2026-11-02";      // test week 1

function getKey() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }
function setKey(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch {} }

// ---- dates (Pacific time) ----
function ptParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, mins: +p.hour * 60 + +p.minute, wd: p.weekday };
}
function addDays(ymd, n) { const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dow(ymd) { return new Date(ymd + "T12:00:00Z").getUTCDay(); }   // 0 Sun .. 6 Sat
function tradingDay() { let d = ptParts().ymd; while (dow(d) === 0 || dow(d) === 6) d = addDays(d, -1); return d; }
function clock(hhmm) { let [h, m] = hhmm.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(m).padStart(2, "0")} ${ap}`; }

// ---- GitHub ----
async function gh(path) {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=main`, {
    headers: { Authorization: `Bearer ${getKey()}`, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store",
  });
  if (r.status === 404) return null;
  if (r.status === 401 || r.status === 403) throw new Error("key");
  if (!r.ok) throw new Error("net");
  return r.text();
}

// ---- log parsing ----
function parseLog(text) {
  const trades = [], open = new Map();
  let last = null, m;
  const seen = new Set();
  for (const ln of (text || "").split("\n")) {
    if (!/^\d\d:\d\d:\d\d /.test(ln)) continue;
    if (/PLAYS: SOLD/.test(ln)) { if (seen.has(ln)) continue; seen.add(ln); }  // the bot can print the same sale twice
    last = ln.slice(0, 5);
    const t = ln.slice(0, 5);
    if ((m = ln.match(/PLAYS: SOLD ([\d.]+) (\S+) @ ([\d.]+) \(([^)]+)\) P&L ([+-]?\d+(?:\.\d+)?) \[([^\]]+)\]/))) {
      const who = m[6] === "eva" ? "eva" : "plays";
      trades.push({ t, tk: m[2], who, pl: +m[5], why: who === "eva" ? "Bounce sold" : m[6] });
      open.delete(who + m[2]);
    } else if ((m = ln.match(/PLAYS: FILLED ([\d.]+) (\S+) @ ([\d.]+) \[([^\]]+)\]/))) {
      const who = m[4] === "eva" ? "eva" : "plays";
      open.set(who + m[2], { t, tk: m[2], who, qty: +m[1], px: +m[3], why: m[4] });
    } else if ((m = ln.match(/PLAYS: still holding ([\d.]+) (\S+) \(([^)]+)\)/))) {
      const who = m[3] === "eva" ? "eva" : "plays";
      open.set(who + m[2], { t: null, tk: m[2], who, qty: +m[1], px: null, why: m[3] });
    } else if ((m = ln.match(/^\d\d:\d\d:\d\d (\[NEW\] )?(\S+) [^:]*: CLOSED @ ([\d.]+) \(([^)]+)\) P&L ([+-]?\d+(?:\.\d+)?)/))) {
      const who = m[1] ? "kona" : "naiya";
      const why = { target: "Hit target", stop: "Stopped out", timeout: "Time ran out", "flatten time": "Sold at day end", "trailing stop": "Runner trailed" }[m[4]] || m[4];
      trades.push({ t, tk: m[2], who, pl: +m[5], why });
      open.delete(who + m[2]);
    } else if ((m = ln.match(/^\d\d:\d\d:\d\d (\[NEW\] )?(\S+) [^:]*: FILLED ([\d.]+) @ ([\d.]+)\./))) {
      const who = m[1] ? "kona" : "naiya";
      open.set(who + m[2], { t, tk: m[2], who, qty: +m[3], px: +m[4] });
    }
  }
  return { trades, open: [...open.values()], last };
}

// ---- faces ----
function face(kind) {
  if (kind === "plays") return `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 28 L16 20 L22 24 L32 12" fill="none" stroke="var(--plays)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 12 H32 V18" fill="none" stroke="var(--plays)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const naiya = kind === "naiya", eva = kind === "eva";
  const ear = naiya ? "#141414" : eva ? "#B9804A" : "#4A3426", head = naiya ? "#F7F5F2" : eva ? "#E8C08E" : "#5E4330", muz = naiya ? "#DCD6D0" : eva ? "#3A2A20" : "#2A1D16";
  const marks = eva ? `<ellipse cx="20" cy="27" rx="9" ry="7" fill="#3A2A20" opacity=".55"/>` : naiya
    ? `<ellipse cx="13.5" cy="20" rx="7" ry="7.5" fill="#141414"/><ellipse cx="26.5" cy="20" rx="7" ry="7.5" fill="#141414"/><rect x="18" y="10" width="4" height="16" rx="2" fill="#F7F5F2"/>`
    : `<path d="M10 16 l3 6 M15 13 l2 7 M26 13 l-2 7 M30 16 l-3 6" stroke="#3B2A1F" stroke-width="1.2"/>`;
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M9 20 L6 5 Q13 6 16 13Z" fill="${ear}"/><path d="M31 20 L34 5 Q27 6 24 13Z" fill="${ear}"/>
   <ellipse cx="20" cy="23" rx="13" ry="11.5" fill="${head}"/>${marks}
   <ellipse cx="20" cy="28" rx="6.5" ry="5" fill="${muz}"/><ellipse cx="20" cy="25.5" rx="2.8" ry="1.9" fill="#111"/>
   <circle cx="14.5" cy="21" r="1.8" fill="#111"/><circle cx="25.5" cy="21" r="1.8" fill="#111"/></svg>`;
}

// ---- render ----
function render(D, day) {
  const T = D.trades;
  const sum = (k) => T.filter((t) => k === "all" || t.who === k).reduce((a, t) => a + t.pl, 0);
  const total = sum("all"), wins = T.filter((t) => t.pl > 0).length;
  const isToday = day === ptParts().ymd;
  const long = new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
  $("past").hidden = !sel;
  $("past-txt").textContent = `Looking at ${long}`;
  $("line-h").textContent = sel ? "That day's line" : "Today's line";
  $("eyebrow").textContent = isToday ? "Today's profit · paper" : `${new Date(day + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })} · paper`;
  $("total").textContent = T.length ? fmt(total) : "$0.00";
  $("sub").textContent = T.length ? `${T.length} trades · ${wins} wins · ${T.length - wins} losses` : "No closed trades yet";
  const hero = $("hero");
  hero.classList.toggle("wait", !T.length);
  hero.classList.toggle("red", T.length > 0 && total < 0);
  $("note").textContent = !T.length ? "The frenchies are waiting for the first trade." : total >= 0 ? "The frenchies are dancing." : (sel ? "Too sad to look. They danced again later." : "Too sad to look. They'll dance again tomorrow.");
  const red = T.length && total < 0;
  const want = red ? (reduce ? "cry_still.webp" : "cry.webp") : (T.length && !reduce) ? "dance.webp" : "still.webp";
  if (!$("dogimg").src.endsWith(want)) $("dogimg").src = want;

  $("bots").innerHTML = Object.entries(BOTS).map(([k, b]) => {
    const tt = T.filter((t) => t.who === k), w = tt.filter((t) => t.pl > 0).length, s = sum(k);
    const o = D.open.filter((x) => x.who === k).length;
    return `<div class="bot ${k}" style="--c:${b.c}"><div class="who">${face(k)}<div><b>${b.name}</b><small>${b.role}</small></div></div>
      <div class="pl num ${tt.length ? cls(s) : ""}">${tt.length ? fmt(s) : "$0.00"}</div><div class="wl num">${w}W · ${tt.length - w}L${o ? ` · ${o} open` : ""}</div></div>`;
  }).join("");

  const rows = T.filter((t) => filt === "all" || t.who === filt).slice().reverse();
  $("trades").innerHTML = rows.map((t) => `<li><span class="t num">${clock(t.t).replace(/ (AM|PM)/, "")}</span>
     <div class="tk" style="--c:${BOTS[t.who].c}"><b>${t.tk}</b><span class="tag">${BOTS[t.who].name}</span><span class="why">${t.why}</span></div>
     <span class="amt num ${cls(t.pl)}">${fmt(t.pl)}</span></li>`).join("") || `<li class="empty">No closed trades yet.</li>`;
  const op = D.open.filter((x) => filt === "all" || x.who === filt);
  $("open").innerHTML = op.map((x) => `<div class="open"><span>Open: <b>${x.tk}</b> · ${BOTS[x.who].name} · ${x.qty} sh</span><span class="num">${x.px ? "@ $" + x.px.toFixed(2) : "held overnight"}</span></div>`).join("");
  drawLine(T, total);
}

function mins(s) { const [h, m] = s.split(":").map(Number); return h * 60 + m; }
function drawLine(T, total) {
  const W = 340, H = 150, L = 44, R = 12, Tp = 12, B = 24, x0 = 390, x1 = 780;
  const sorted = T.slice().sort((a, b) => mins(a.t) - mins(b.t));
  let c = 0; const pts = [[x0, 0]];
  sorted.forEach((t) => { c += t.pl; pts.push([Math.min(x1, Math.max(x0, mins(t.t))), c, t]); });
  const vals = pts.map((p) => p[1]);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = hi - lo, step = span > 160 ? 50 : span > 60 ? 25 : span > 30 ? 10 : 5;
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi === lo) hi = lo + step;
  const X = (m) => L + (m - x0) / (x1 - x0) * (W - L - R), Y = (v) => Tp + (hi - v) / (hi - lo) * (H - Tp - B);
  const col = total < 0 ? "var(--down)" : "var(--up)";
  let d = `M${X(pts[0][0])},${Y(0)}`; pts.slice(1).forEach((p) => { d += ` H${X(p[0]).toFixed(1)} V${Y(p[1]).toFixed(1)}`; });
  const lastP = pts[pts.length - 1];
  const area = d + ` H${X(lastP[0])} V${Y(0)} Z`;
  let grid = ""; for (let v = lo; v <= hi; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" ${v === 0 ? 'stroke-dasharray="3 3" stroke-width="1.5"' : ""}/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${v < 0 ? "−" : ""}$${Math.abs(v)}</text>`;
  const ticks = [[390, "6:30"], [540, "9:00"], [660, "11:00"], [780, "1:00"]].map(([m, l]) => `<text x="${X(m)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${l}</text>`).join("");
  const dots = pts.slice(1).map((p, i) => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="12" fill="transparent" data-i="${i}"/>`).join("");
  const endLbl = pts.length > 1 ? `<circle cx="${X(lastP[0])}" cy="${Y(lastP[1])}" r="5" fill="${col}" stroke="var(--card)" stroke-width="2"/>
    <text x="${Math.min(X(lastP[0]) + 8, W - 60)}" y="${Y(lastP[1]) - 8}" font-size="11" font-weight="800" fill="var(--ink)">${fmt(lastP[1])}</text>` : "";
  $("line").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Running profit through the day">
    ${grid}${ticks}${pts.length > 1 ? `<path d="${area}" fill="${col}" opacity=".12"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>` : ""}
    ${endLbl}<g>${dots}</g></svg><div class="tip"></div>`;
  const tip = $("line").querySelector(".tip"), svg = $("line").querySelector("svg");
  svg.querySelectorAll("g circle").forEach((el) => {
    const p = pts[+el.dataset.i + 1];
    const show = () => { const r = svg.getBoundingClientRect(), k = r.width / W; tip.style.left = X(p[0]) * k + "px"; tip.style.top = Y(p[1]) * k + "px";
      tip.textContent = `${clock(p[2].t)} ${p[2].tk} ${fmt(p[2].pl)} → day ${fmt(p[1])}`; tip.classList.add("on"); };
    el.addEventListener("pointerenter", show); el.addEventListener("click", show); el.addEventListener("pointerleave", () => tip.classList.remove("on"));
  });
}

function weekNo(mon) { return Math.round((new Date(mon + "T12:00:00Z") - new Date(FIRST_MON + "T12:00:00Z")) / 6048e5) + 1; }
function drawWeek(live, mon, totals) {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const shown = sel || live;
  const wk = names.map((n, i) => { const d = addDays(mon, i); return [n, totals[d] ?? null, d === live, d, d === shown]; });
  const W = 340, H = 150, Tp = 18, B = 22, max = Math.max(20, ...wk.map((d) => Math.abs(d[1] || 0))) * 1.15;
  const mid = Tp + (H - Tp - B) / 2, sc = (H - Tp - B) / 2 / max, bw = 34, gap = (W - bw * 5) / 5;
  let s = `<line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--line)" stroke-width="1.5"/>`;
  wk.forEach((d, i) => {
    const cx = gap / 2 + i * (bw + gap) + bw / 2, v = d[1];
    let g = d[4] ? `<rect x="${cx - bw / 2 - 5}" y="2" width="${bw + 10}" height="${H - 4}" rx="10" fill="var(--chip)"/>` : "";
    if (v == null) g += `<rect x="${cx - bw / 2}" y="${mid - 14}" width="${bw}" height="28" rx="6" fill="none" stroke="var(--line)" stroke-dasharray="3 3"/>`;
    else {
      const h = Math.max(3, Math.abs(v) * sc), y = v >= 0 ? mid - h : mid, col = v >= 0 ? "var(--up)" : "var(--down)";
      g += `<path d="${v >= 0 ? `M${cx - bw / 2},${mid} V${y + 4} q0,-4 4,-4 H${cx + bw / 2 - 4} q4,0 4,4 V${mid}Z` : `M${cx - bw / 2},${mid} V${y + h - 4} q0,4 4,4 H${cx + bw / 2 - 4} q4,0 4,-4 V${mid}Z`}" fill="${col}"><title>${d[0]} ${fmt(v)}</title></path>
      <text x="${cx}" y="${v >= 0 ? y - 5 : y + h + 12}" text-anchor="middle" font-size="11" font-weight="800" fill="var(--ink)">${fmt(v)}</text>`;
    }
    g += `<text x="${cx}" y="${H - 4}" text-anchor="middle" font-size="11" font-weight="${d[4] ? 800 : 600}" fill="${d[4] ? "var(--ink)" : "var(--muted)"}">${d[2] && d[3] === ptParts().ymd ? "Today" : d[0]}</text>`;
    const tap = d[3] <= live && v != null;
    s += tap ? `<g class="day" data-d="${d[3]}" role="button" aria-label="Show ${d[0]}">${g}<rect x="${cx - bw / 2 - 8}" y="0" width="${bw + 16}" height="${H}" fill="transparent"/></g>` : g;
  });
  $("week").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily profit for the week">${s}</svg>`;
  $("week").querySelectorAll(".day").forEach((el) => el.addEventListener("click", () => {
    const d = el.dataset.d; sel = d === live ? null : d; load(); window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }));
  const tot = wk.reduce((a, d) => a + (d[1] || 0), 0);
  const n = weekNo(mon), fri = addDays(mon, 4);
  const md = (x) => new Date(x + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  $("wk-h").textContent = wkOff === 0 ? (n >= 1 ? `This week · Week ${n}` : "This week") : (n >= 1 ? `Week ${n} · ${md(mon)}–${md(fri)}` : `${md(mon)}–${md(fri)}`);
  $("wk-total").innerHTML = `${wkOff === 0 ? "Week so far" : "Week total"}: <b class="num ${cls(tot)}">${fmt(tot)}</b>`;
  $("wk-prev").disabled = mon <= FIRST_MON;
  $("wk-next").disabled = wkOff >= 0;
}

// ---- load ----
function setStatus(text, warn) { $("status").innerHTML = `<i class="live" style="${warn ? "background:var(--kona)" : ""}"></i>${text}`; }
function showErr(el, msg) { el.textContent = msg; el.hidden = !msg; }

async function dayLog(d) {             // past days never change, so fetch each once
  if (!(d in dayCache)) dayCache[d] = parseLog(await gh(`results/bot_${d}.log`));
  return dayCache[d];
}

async function load() {
  const day = tradingDay();
  try {
    const text = await gh(`results/bot_${day}.log`);
    const D = parseLog(text);
    today = D;
    showErr($("err"), "");
    if (sel && sel >= day) sel = null;
    render(sel ? await dayLog(sel) : D, sel || day);
    const now = ptParts();
    if (!text) setStatus("No results yet today");
    else {
      const age = day === now.ymd ? now.mins - mins(D.last) : 0;
      const market = day === now.ymd && now.mins >= 390 && now.mins <= 790;
      setStatus(`Updated ${clock(D.last)}${market && age > 12 ? " · bot quiet" : ""}`, market && age > 12);
    }
    // week: past days once, today every time
    const totals = {};
    const mon = addDays(addDays(day, -((dow(day) + 6) % 7)), 7 * wkOff);
    for (let i = 0; i < 5; i++) {
      const d = addDays(mon, i);
      if (d > day) break;
      const p = d === day ? D : await dayLog(d);
      totals[d] = p.trades.length ? p.trades.reduce((a, t) => a + t.pl, 0) : null;
    }
    drawWeek(day, mon, totals);
  } catch (e) {
    if (e.message === "key") {
      showErr($("err"), "GitHub turned the key down. It may have expired. Tap \"Remove key from this phone\" and paste a new read-only key.");
    } else {
      showErr($("err"), "Couldn't reach GitHub. Showing the last numbers; trying again in a minute.");
    }
    setStatus("Offline", true);
  }
}

function start() {
  const has = !!getKey();
  $("setup").hidden = has;
  $("main").hidden = !has;
  if ($("mine")) { $("mine").hidden = true; $("me-open").hidden = true; }   // guard: an old cached page may not have these yet
  clearInterval(timer);
  if (has) { load(); loadMe(); timer = setInterval(() => { if (!document.hidden) load(); }, 60000); }
  else setStatus("Not connected", true);
}

$("save").addEventListener("click", async () => {
  const v = $("key").value.trim();
  if (!v) { showErr($("setup-err"), "Paste the key first."); return; }
  setKey(v);
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { Authorization: `Bearer ${v}` } });
    if (!r.ok) throw new Error();
    $("key").value = ""; showErr($("setup-err"), ""); start();
  } catch {
    setKey("");
    showErr($("setup-err"), "That key didn't work. Check that it has read access to the scalp-bot repo and try again.");
  }
});
$("forget").addEventListener("click", () => { setKey(""); dayCache = {}; sel = null; wkOff = 0; start(); });
$("back").addEventListener("click", () => { sel = null; wkOff = 0; load(); });
$("wk-prev").addEventListener("click", () => { wkOff--; load(); });
$("wk-next").addEventListener("click", () => { if (wkOff < 0) wkOff++; load(); });
$("refresh").addEventListener("click", load);
document.addEventListener("visibilitychange", () => { if (!document.hidden && getKey()) load(); });
document.querySelectorAll(".chips button").forEach((b) => b.addEventListener("click", () => {
  filt = b.dataset.f; document.querySelectorAll(".chips button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  if (today) render(sel && dayCache[sel] ? dayCache[sel] : today, sel || tradingDay());
}));
start();

// ---- my own trading (James's trades, not the bots): me/my_trades.json in the scalp-bot repo ----
let meOpen = false, meDay = null;
function shortDay(ymd) { return new Date(ymd + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }); }
async function loadMe() {
  let M;
  try { const t = await gh("me/my_trades.json"); if (!t) { $("me-open").hidden = true; return; } M = JSON.parse(t); } catch { return; }
  const floor = M.floor || 25;
  const days = (M.days || []).map((d) => {
    const tr = d.trades || [];
    const pl = d.pl != null ? d.pl : tr.reduce((a, t) => a + (+t.pl || 0), 0);
    return { ...d, tr, pl: Math.round(pl * 100) / 100 };
  }).sort((a, b) => (a.date < b.date ? 1 : -1));
  $("me-open").hidden = !days.length;
  if (!days.length) return;
  const total = days.reduce((a, d) => a + d.pl, 0);
  const hits = days.filter((d) => d.pl >= floor).length, greens = days.filter((d) => d.pl > 0).length;
  const money = (v) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const st = M.start || { date: days[days.length - 1].date };
  const md = (x) => new Date(x + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const lastBal = days.find((d) => d.bal)?.bal;
  const pct = st.bal ? ` (${total >= 0 ? "+" : "−"}${Math.abs(total / st.bal * 100).toFixed(1)}%)` : "";
  if ($("me-total")) $("me-total").innerHTML = `<small>Total profit since ${md(st.date)}</small><b class="num ${cls(total)}">${fmt(total).replace(/(\d)(?=(\d{3})+\.)/g, "$1,")}</b>
    ${st.bal && lastBal ? `<span>Started with ${money(st.bal)} · now ${money(lastBal)}${pct}</span>` : ""}`;
  $("me-stats").innerHTML = `<div>Days traded<b class="num">${days.length}</b></div>
    <div>Green days<b class="num">${greens} of ${days.length}</b></div>
    <div>Hit $${floor}+<b class="num">${hits} of ${days.length}</b></div>`;
  const badge = (pl) => pl >= floor ? `<span class="badge hit">$${floor}+ ✓</span>` : pl < 0 ? `<span class="badge red">Red day</span>` : `<span class="badge miss">$${(floor - pl).toFixed(2)} to $${floor}</span>`;
  $("me-days").innerHTML = days.map((d) => `<li><button class="dr" data-d="${d.date}" aria-expanded="${meDay === d.date}">
      <span class="dd">${shortDay(d.date)}${d.tr.length ? ` <small style="color:var(--muted);font-weight:600">· ${d.tr.length} trades</small>` : ""}</span>
      ${badge(d.pl)}<span class="amt num ${cls(d.pl)}">${fmt(d.pl)}</span></button>
      ${meDay === d.date ? `<ul class="metr">${d.bal ? `<li><span>Account at close</span><span class="num" style="font-weight:800">$${d.bal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></li>` : ""}${d.tr.map((t) => `<li><span><b>${t.tk}</b>${t.qty ? ` · ${t.qty} sh` : ""}${t.buy ? ` · $${t.buy} → $${t.sell}` : ""}${t.why ? ` · ${t.why}` : ""}</span><span class="num ${cls(+t.pl)}" style="font-weight:800">${fmt(+t.pl)}</span></li>`).join("")}</ul>` : ""}</li>`).join("");
  $("me-days").querySelectorAll("button.dr").forEach((b) => b.addEventListener("click", () => { meDay = meDay === b.dataset.d ? null : b.dataset.d; loadMe(); }));
}
function showMe(on) {
  meOpen = on && !!getKey();
  $("mine").hidden = !meOpen; $("main").hidden = meOpen || !getKey();
  $("me-open").setAttribute("aria-pressed", meOpen);
  window.scrollTo({ top: 0 });
}
$("me-open").addEventListener("click", () => showMe($("mine").hidden));
$("me-close").addEventListener("click", () => showMe(false));
setInterval(() => { if (!document.hidden && getKey()) loadMe(); }, 300000);
document.addEventListener("visibilitychange", () => { if (!document.hidden && getKey()) loadMe(); });
