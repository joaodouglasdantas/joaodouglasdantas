#!/usr/bin/env node
// Fazenda de commits: transforma o gráfico de contribuições do GitHub
// num canteiro animado onde as plantas crescem, florescem e dão frutos.
//
// Uso:
//   GITHUB_TOKEN=xxx node generate.js --user seu-usuario --out dist
//   node generate.js --demo --out dist      (dados de exemplo, sem token)

const fs = require("fs");
const path = require("path");

// ---------- argumentos ----------
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const USER = arg("user", process.env.GITHUB_USER);
const OUT = arg("out", "dist");
const DEMO = args.includes("--demo");

// ---------- dados ----------
async function fetchCalendar(login) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Defina GITHUB_TOKEN (ou use --demo).");
  const query = `query($login:String!){ user(login:$login){ contributionsCollection{
    contributionCalendar{ totalContributions weeks{ contributionDays{
      date contributionCount contributionLevel weekday } } } } } }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login } }),
  });
  const json = await res.json();
  if (json.errors || !json.data?.user) throw new Error(JSON.stringify(json.errors || json));
  const cal = json.data.user.contributionsCollection.contributionCalendar;
  const levelMap = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };
  return {
    total: cal.totalContributions,
    weeks: cal.weeks.map((w) =>
      w.contributionDays.map((d) => ({
        date: d.date, count: d.contributionCount, level: levelMap[d.contributionLevel] ?? 0, weekday: d.weekday,
      }))
    ),
  };
}

function demoCalendar() {
  const weeks = [];
  let total = 0;
  const start = new Date();
  start.setDate(start.getDate() - 364 - start.getDay());
  for (let w = 0; w < 53; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const r = rand(date.toISOString().slice(0, 10) + "demo");
      const season = 0.5 + 0.5 * Math.sin(w / 6);
      const count = r < 0.3 ? 0 : Math.floor(r * 12 * season);
      total += count;
      days.push({ date: date.toISOString().slice(0, 10), count, weekday: d,
        level: count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 9 ? 3 : 4 });
    }
    weeks.push(days);
  }
  return { total, weeks };
}

// número pseudoaleatório estável a partir de uma string (cada dia sempre gera a mesma planta)
function rand(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}
const pick = (arr, seed) => arr[Math.floor(rand(seed) * arr.length)];

// ---------- temas ----------
const THEMES = {
  light: {
    text: "#57606a", textStrong: "#24292f",
    grassTop: "#9ad15f", grassBottom: "#6fb043", grassTile: "#8cc653", grassTileAlt: "#97cf5c", tuft: "#5d9e36",
    dirtFront: "#a9754a", dirtFrontDark: "#7c5132", dirtSide: "#8a5d38", strata: "#6b4529",
    bedLip: "#6e4a2c", bedTop: "#8b5e3a", bedTopLight: "#a4744b", furrow: "#6a452a",
    stem: "#4a8f2f", leafLight: "#8ed65a", leafDark: "#3f8a2a",
    trunk: "#8a5a33", trunkDark: "#5e3b1f", canopyLight: "#7fcf4f", canopyDark: "#2f7a2a",
    cloudLight: "#ffffff", cloudDark: "#c7d3e0", rain: "#4ea1ff", shadow: "#1b3a10",
    woodLight: "#d39a5c", woodDark: "#a4683a", woodEdge: "#6e4222", plank: "#8a5530", signText: "#fff6e3", signShadow: "#5a3418",
    night: false,
  },
  dark: {
    text: "#8b949e", textStrong: "#e6edf3",
    grassTop: "#3f7a3a", grassBottom: "#2a5a2c", grassTile: "#376e35", grassTileAlt: "#3c7439", tuft: "#285a27",
    dirtFront: "#5e3f28", dirtFrontDark: "#3d2717", dirtSide: "#4a3120", strata: "#35220f",
    bedLip: "#3a2615", bedTop: "#503420", bedTopLight: "#654229", furrow: "#3a2615",
    stem: "#4f9a3a", leafLight: "#7cc95a", leafDark: "#2f7a2e",
    trunk: "#6e4a2c", trunkDark: "#48301b", canopyLight: "#5fb24a", canopyDark: "#1f5a24",
    cloudLight: "#d5dde8", cloudDark: "#7d8ba0", rain: "#79c0ff", shadow: "#000000",
    woodLight: "#8a5a33", woodDark: "#5e3a1e", woodEdge: "#2e1a0b", plank: "#3e2511", signText: "#ffe9c2", signShadow: "#1a0d04",
    night: true,
  },
};
const PETALS = [
  ["#ff9ec4", "#e0457f"], ["#e2b0ff", "#9c4fd6"], ["#ffe08a", "#f0a500"],
  ["#a8d8ff", "#3d8fe0"], ["#ffb3a7", "#e8553f"], ["#ffffff", "#d9d9e8"],
];
const FRUITS = [
  ["#ff7a70", "#c62828"], ["#ffb36b", "#e6620a"], ["#c38bff", "#6a1fb0"], ["#fff07a", "#e0b000"],
];

// ---------- geometria isométrica ----------
// cada dia é um losango; semanas andam para a direita, dias da semana para frente
const U = [17, 4];     // +1 semana
const V = [-11, 7.5];  // +1 dia
const DEPTH = 16;      // espessura do terreno
const PAD = 16;
const SKY = 78;        // espaço acima para plantas e nuvem

const CYCLE = 16;       // segundos por ciclo
const GROW_END = 0.6;   // quando a nuvem termina de passar
const HOLD_END = 0.93;  // quando começa a colheita

const f = (n) => +n.toFixed(1);

function render(cal, theme) {
  const t = THEMES[theme];
  const nW = cal.weeks.length;
  const OX = PAD - (-0.4 * U[0] + 7.4 * V[0]);
  const OY = SKY;
  const P = (w, d) => [OX + w * U[0] + d * V[0], OY + w * U[1] + d * V[1]];
  const pt = (w, d, dy = 0) => { const [x, y] = P(w, d); return `${f(x)},${f(y + dy)}`; };
  const poly = (pts, fill, extra = "") => `<polygon points="${pts.join(" ")}" fill="${fill}" ${extra}/>`;

  const [, yMax] = P(nW + 0.4, 7.4);
  const [xMax] = P(nW + 0.4, -0.4);
  const W = Math.ceil(xMax + PAD);
  const H = Math.ceil(yMax + DEPTH + PAD) + 28;

  // ---- terreno ----
  const a = -0.4, b = nW + 0.4, c = -0.4, e = 7.4;
  let ground = "";
  ground += poly([pt(a, e), pt(b, e), pt(b, e, DEPTH), pt(a, e, DEPTH)], "url(#dirtFront)");
  ground += poly([pt(b, c), pt(b, e), pt(b, e, DEPTH), pt(b, c, DEPTH)], t.dirtSide);
  for (const k of [0.45, 0.75]) {
    ground += `<path d="M${pt(a, e, DEPTH * k)} L${pt(b, e, DEPTH * k)} L${pt(b, c, DEPTH * k)}" stroke="${t.strata}" stroke-width="1" fill="none" opacity=".35" stroke-dasharray="7 4"/>`;
  }
  ground += poly([pt(a, c), pt(b, c), pt(b, e), pt(a, e)], "url(#grass)");
  // borda de grama caindo sobre a terra
  ground += `<path d="M${pt(a, e)} L${pt(b, e)} L${pt(b, c)}" stroke="${t.grassBottom}" stroke-width="3" fill="none" stroke-linejoin="round"/>`;

  // ---- canteiros ----
  const g = 0.09;
  let tiles = "";
  const plants = [];
  cal.weeks.forEach((days, w) => {
    days.forEach((day) => {
      const d = day.weekday;
      const corners = (dy) => [pt(w + g, d + g, dy), pt(w + 1 - g, d + g, dy), pt(w + 1 - g, d + 1 - g, dy), pt(w + g, d + 1 - g, dy)];
      const title = `<title>${day.date}: ${day.count} contribuições</title>`;
      if (day.level === 0) {
        const alt = (w + d) % 2 === 0;
        tiles += `<polygon points="${corners(0).join(" ")}" fill="${alt ? t.grassTile : t.grassTileAlt}">${title}</polygon>`;
        if (rand(day.date + "tuft") < 0.35) {
          const [x, y] = P(w + 0.3 + rand(day.date + "tx") * 0.4, d + 0.3 + rand(day.date + "ty") * 0.4);
          tiles += `<path d="M${f(x - 2)} ${f(y)}l1 -3M${f(x)} ${f(y)}v-3.6M${f(x + 2)} ${f(y)}l-1 -3" stroke="${t.tuft}" stroke-width=".9" stroke-linecap="round"/>`;
        }
      } else {
        const lift = 2.4;
        tiles += `<polygon points="${corners(0).join(" ")}" fill="${t.bedLip}"/>`;
        tiles += `<polygon points="${corners(-lift).join(" ")}" fill="url(#bed)">${title}</polygon>`;
        // sulcos na terra
        for (const k of [0.35, 0.65]) {
          tiles += `<path d="M${pt(w + 0.2, d + k, -lift)} L${pt(w + 0.8, d + k, -lift)}" stroke="${t.furrow}" stroke-width=".8" opacity=".6"/>`;
        }
        const [x, y] = P(w + 0.5, d + 0.5);
        plants.push({ w, x, y: y - lift, level: day.level, seed: day.date });
      }
    });
  });

  plants.sort((p, q) => p.y - q.y);
  const plantSvg = plants
    .map((p) => `<g transform="translate(${f(p.x)} ${f(p.y)})"><g class="p w${p.w}">${plant(p.level, p.seed, t)}</g></g>`)
    .join("");

  // ---- animação ----
  const pct = (x) => (x * 100).toFixed(2) + "%";
  const startCol = -2, endCol = nW + 2;
  const at = (w) => ((w + 0.5 - startCol) / (endCol - startCol)) * GROW_END;
  let css = "";
  for (let w = 0; w < nW; w++) {
    const s = at(w), en = s + 0.045;
    css += `@keyframes g${w}{0%,${pct(s)}{transform:scale(0)}${pct(en - 0.012)}{transform:scale(1.12)}${pct(en)},${pct(HOLD_END)}{transform:scale(1)}100%{transform:scale(0)}}.w${w}{animation:g${w} ${CYCLE}s ease-out infinite}`;
  }
  const [cx0, cy0] = P(startCol, 3.5);
  const [cx1, cy1] = P(endCol, 3.5);
  css += `@keyframes move{0%{transform:translate(${f(cx0)}px,${f(cy0)}px);opacity:0}4%{opacity:1}${pct(GROW_END - 0.03)}{opacity:1}${pct(GROW_END)}{transform:translate(${f(cx1)}px,${f(cy1)}px);opacity:0}100%{transform:translate(${f(cx1)}px,${f(cy1)}px);opacity:0}}`;
  css += `.cloud{animation:move ${CYCLE}s linear infinite}`;
  css += `@keyframes rain{to{stroke-dashoffset:-20}}.rain{stroke-dasharray:5 5;animation:rain .45s linear infinite}`;
  css += `@keyframes float{50%{transform:translateY(-3px)}}.puff{animation:float 3s ease-in-out infinite}`;

  const cloud = `<g class="cloud">
    <ellipse cx="0" cy="0" rx="26" ry="9" fill="${t.shadow}" opacity="${t.night ? 0.35 : 0.18}"/>
    <g stroke="${t.rain}" stroke-width="1.3" stroke-linecap="round" opacity=".8" class="rain">
      <path d="M-12 -46V-6"/><path d="M-4 -44V-2"/><path d="M5 -45V-4"/><path d="M13 -46V-7"/>
    </g>
    <g class="puff" filter="url(#soft)">
      <circle cx="-15" cy="-54" r="10" fill="url(#cloud)"/>
      <circle cx="15" cy="-54" r="10" fill="url(#cloud)"/>
      <circle cx="-3" cy="-62" r="14" fill="url(#cloud)"/>
      <circle cx="10" cy="-60" r="10" fill="url(#cloud)"/>
      <rect x="-15" y="-56" width="30" height="12" rx="6" fill="url(#cloud)"/>
    </g>
  </g>`;

  // ---- vaga-lumes (tema noite) ----
  let fireflies = "";
  if (t.night) {
    css += `@keyframes blink{0%,100%{opacity:0}50%{opacity:1}}@keyframes drift{50%{transform:translate(4px,-6px)}}`;
    for (let i = 0; i < 22; i++) {
      const w = rand("ffw" + i) * nW, d = rand("ffd" + i) * 7;
      const [x, y] = P(w, d);
      const dy = 10 + rand("ffh" + i) * 26;
      const dur = (2 + rand("ffs" + i) * 3).toFixed(1), delay = (rand("ffl" + i) * 5).toFixed(1);
      fireflies += `<g style="animation:drift ${dur * 2}s ease-in-out ${delay}s infinite"><circle cx="${f(x)}" cy="${f(y - dy)}" r="1.6" fill="#fff59d" filter="url(#glow)" style="animation:blink ${dur}s ease-in-out ${delay}s infinite;opacity:0"/></g>`;
    }
  }

  // ---- defs ----
  const grad = (id, c1, c2, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;
  const rad = (id, c1, c2) => `<radialGradient id="${id}" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></radialGradient>`;
  const defs = `<defs>
    ${grad("grass", t.grassTop, t.grassBottom, 1, 1)}
    ${grad("dirtFront", t.dirtFront, t.dirtFrontDark)}
    ${grad("bed", t.bedTopLight, t.bedTop, 1, 1)}
    ${grad("leaf", t.leafLight, t.leafDark, 1, 1)}
    ${grad("trunk", t.trunk, t.trunkDark, 1, 0)}
    ${rad("canopy", t.canopyLight, t.canopyDark)}
    ${rad("cloud", t.cloudLight, t.cloudDark)}
    ${rad("center", "#fff3b0", "#e0a000")}
    ${grad("wood", t.woodLight, t.woodDark)}
    ${grad("post", t.woodDark, t.woodEdge, 1, 0)}
    <filter id="engrave"><feDropShadow dx="0" dy="1.5" stdDeviation="0" flood-color="${t.signShadow}" flood-opacity=".8"/></filter>
    ${PETALS.map(([l, dk], i) => rad("pe" + i, l, dk)).join("")}
    ${FRUITS.map(([l, dk], i) => rad("fr" + i, l, dk)).join("")}
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2" stdDeviation="1.5" flood-opacity=".18"/></filter>
    <filter id="glow" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`;

  const all = cal.weeks.flat();
  const harvest = all.filter((d) => d.level === 4).length;
  const flowers = all.filter((d) => d.level === 3).length;
  let streak = 0, run = 0;
  for (const d of all) { run = d.count > 0 ? run + 1 : 0; streak = Math.max(streak, run); }
  const label = sign(t, { user: cal.user, total: cal.total, flowers, harvest, streak }, PAD + 6, H - PAD - 146);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
${defs}
<style>
.p{transform-box:fill-box;transform-origin:50% 100%}
${css}
text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
.s-title{font-size:12px;font-weight:700;letter-spacing:1.5px;fill:${t.signText};opacity:.85}
.s-big{font-size:30px;font-weight:800;fill:${t.signText}}
.s-unit{font-size:14px;font-weight:600;fill:${t.signText};opacity:.9}
.s-stat{font-size:14px;font-weight:700;fill:${t.signText}}
.s-lbl{font-size:11px;fill:${t.signText};opacity:.8}
</style>
${ground}
${tiles}
${plantSvg}
${fireflies}
${cloud}
${label}
</svg>`;
}

// ---------- placa de madeira ----------
function sign(t, s, x, y) {
  const w = 346, h = 112;
  const esc = (v) => String(v).replace(/[<>&"]/g, "");
  const icon = {
    flower: `<g transform="translate(8 -5)">${[0, 72, 144, 216, 288].map((a) => { const r = a * Math.PI / 180; return `<circle cx="${f(Math.cos(r) * 3.6)}" cy="${f(Math.sin(r) * 3.6)}" r="3" fill="url(#pe0)"/>`; }).join("")}<circle r="2.2" fill="url(#center)"/></g>`,
    fruit: `<g transform="translate(8 -5)"><path d="M0 -5q1 -4 4 -4" stroke="#5a3a1a" stroke-width="1.3" fill="none"/><ellipse cx="3" cy="-7" rx="2.6" ry="1.3" fill="url(#leaf)"/><circle r="5.5" fill="url(#fr0)"/><circle cx="-2" cy="-2" r="1.3" fill="#fff" opacity=".7"/></g>`,
    drop: `<g transform="translate(8 -5)"><path d="M0 -7C3 -3 5 0 5 2.5A5 5 0 0 1 -5 2.5C-5 0 -3 -3 0 -7Z" fill="#6cb8ff" stroke="#2f7fd8" stroke-width=".8"/><circle cx="-1.8" cy="1.5" r="1.1" fill="#fff" opacity=".7"/></g>`,
  };
  const stat = (ix, n, lbl, sx) => `<g transform="translate(${sx} ${h - 20})">${icon[ix]}<text x="20" y="0" class="s-stat">${n}</text><text x="${20 + String(n).length * 8.6 + 4}" y="0" class="s-lbl">${lbl}</text></g>`;
  const planks = [h / 3, (2 * h) / 3].map((py) => `<path d="M6 ${f(py)}H${w - 6}" stroke="${t.plank}" stroke-width="1.2" opacity=".55"/>`).join("");
  const grain = [14, 44, 80].map((py, i) => `<path d="M${20 + i * 30} ${py}q40 -3 90 0t90 1" stroke="${t.plank}" stroke-width=".7" fill="none" opacity=".35"/>`).join("");
  const nails = [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]].map(([nx, ny]) => `<circle cx="${nx}" cy="${ny}" r="2" fill="${t.woodEdge}"/><circle cx="${nx - 0.6}" cy="${ny - 0.6}" r=".7" fill="#fff" opacity=".4"/>`).join("");
  const post = (px) => `<rect x="${px}" y="${h - 6}" width="12" height="30" rx="2" fill="url(#post)"/><ellipse cx="${px + 6}" cy="${h + 24}" rx="12" ry="3.5" fill="#000" opacity=".2"/>`;
  return `<g transform="translate(${x} ${y})">
    ${post(40)}${post(w - 52)}
    <rect x="0" y="3" width="${w}" height="${h}" rx="8" fill="#000" opacity=".22"/>
    <rect x="0" y="0" width="${w}" height="${h}" rx="8" fill="url(#wood)" stroke="${t.woodEdge}" stroke-width="2"/>
    ${planks}${grain}${nails}
    <text x="22" y="26" class="s-title">FAZENDA DE ${esc(s.user || "").toUpperCase()}</text>
    <g filter="url(#engrave)">
      <text x="22" y="62" class="s-big">${s.total.toLocaleString("pt-BR")}</text>
      <text x="${22 + s.total.toLocaleString("pt-BR").length * 15.5 + 6}" y="62" class="s-unit">contribuições no último ano</text>
    </g>
    ${stat("flower", s.flowers, "flores", 18)}${stat("fruit", s.harvest, "colheitas", 112)}${stat("drop", s.streak, "dias seguidos", 222)}
  </g>`;
}

// ---------- plantas (desenhadas com a base em 0,0) ----------
const leaf = (x, y, len, ang, w = 0.45) =>
  `<path d="M0 0Q${f(len / 2)} ${f(-len * w)} ${len} 0Q${f(len / 2)} ${f(len * w)} 0 0Z" fill="url(#leaf)" transform="translate(${f(x)} ${f(y)}) rotate(${f(ang)})"/>`;
const shadow = (rx) => `<ellipse cx="0" cy="0" rx="${rx}" ry="${f(rx * 0.4)}" fill="#000" opacity=".22"/>`;

function plant(level, seed, t) {
  const lean = (rand(seed + "l") - 0.5) * 3;
  const pe = Math.floor(rand(seed + "p") * PETALS.length);
  const fr = Math.floor(rand(seed + "f") * FRUITS.length);
  const flip = rand(seed + "x") < 0.5 ? -1 : 1;

  switch (level) {
    case 1: // broto
      return `${shadow(4)}
        <path d="M0 0Q${f(lean * 0.3)} -3 0 -6" stroke="${t.stem}" stroke-width="1.3" fill="none" stroke-linecap="round"/>
        ${leaf(0, -6, 5.5, -155)}${leaf(0, -6, 5.5, -25)}`;
    case 2: // muda com folhas
      return `${shadow(6)}
        <path d="M0 0Q${f(lean)} -7 ${f(lean * 0.4)} -14" stroke="${t.stem}" stroke-width="1.5" fill="none" stroke-linecap="round"/>
        ${leaf(0, -3, 7, -160 * flip + (flip < 0 ? 0 : 0))}${leaf(0, -5, 7.5, -20)}
        ${leaf(lean * 0.5, -9, 6.5, -150)}${leaf(lean * 0.5, -10.5, 6, -35)}
        ${leaf(lean * 0.4, -14, 5, -80)}`;
    case 3: { // flor
      const fx = lean * 0.6, fy = -20;
      let petals = "";
      for (let i = 0; i < 6; i++) {
        const ang = i * 60;
        const r = (ang * Math.PI) / 180;
        const px = fx + Math.cos(r) * 3.4, py = fy + Math.sin(r) * 2.4;
        petals += `<ellipse cx="${f(px)}" cy="${f(py)}" rx="3.2" ry="2.2" fill="url(#pe${pe})" transform="rotate(${ang} ${f(px)} ${f(py)})"/>`;
      }
      return `${shadow(6.5)}
        <path d="M0 0Q${f(lean)} -10 ${f(fx)} ${fy}" stroke="${t.stem}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
        ${leaf(0, -4, 8, -165)}${leaf(0, -6, 8, -15)}${leaf(lean * 0.6, -12, 6.5, -145)}
        ${petals}<ellipse cx="${f(fx)}" cy="${fy}" rx="2.4" ry="1.9" fill="url(#center)"/>`;
    }
    case 4: { // árvore frutífera
      const fruits = [[-6, -20], [5, -23], [-1, -28], [7, -16], [-4, -14]]
        .filter((_, i) => rand(seed + "fr" + i) < 0.85)
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.3" fill="url(#fr${fr})"/><circle cx="${x - 0.8}" cy="${y - 0.8}" r=".6" fill="#fff" opacity=".8"/>`)
        .join("");
      return `${shadow(10)}
        <path d="M-1.6 0L-1 -12L1 -12L1.6 0Z" fill="url(#trunk)"/>
        <path d="M0 -9L-4 -13M0 -10L4 -14" stroke="${t.trunkDark}" stroke-width="1.2" stroke-linecap="round"/>
        <circle cx="-6" cy="-17" r="7" fill="url(#canopy)"/>
        <circle cx="6" cy="-18" r="7" fill="url(#canopy)"/>
        <circle cx="0" cy="-24" r="8.5" fill="url(#canopy)"/>
        ${fruits}`;
    }
    default:
      return "";
  }
}

// ---------- main ----------
(async () => {
  if (!DEMO && !USER) throw new Error("Informe --user seu-usuario (ou use --demo).");
  const cal = DEMO ? demoCalendar() : await fetchCalendar(USER);
  cal.user = USER || "demo";
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "farm.svg"), render(cal, "light"));
  fs.writeFileSync(path.join(OUT, "farm-dark.svg"), render(cal, "dark"));
  console.log(`Fazenda gerada em ${OUT}/ (${cal.total} contribuições)`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
