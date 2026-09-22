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
    text: "#57606a", soil: "#d8b48a", soilDark: "#b98d5e", soilEmpty: "#e9d6bd",
    stem: "#3f8f3a", leaf: "#5cb85c", leafDark: "#2e7d32", center: "#ffc107",
    cloud: "#ffffff", cloudEdge: "#c9d6e3", rain: "#58a6ff",
  },
  dark: {
    text: "#8b949e", soil: "#5b4030", soilDark: "#46301f", soilEmpty: "#2d2219",
    stem: "#56b04f", leaf: "#6fcf6a", leafDark: "#3c9a3a", center: "#ffd54f",
    cloud: "#c9d1d9", cloudEdge: "#6e7681", rain: "#79c0ff",
  },
};
const PETALS = ["#f06292", "#ba68c8", "#ffb74d", "#64b5f6", "#ff8a80", "#fff176"];
const FRUITS = ["#e53935", "#ff7043", "#8e24aa", "#fdd835", "#43a047"];

// ---------- desenho ----------
const CELL = 16;      // tamanho de cada canteiro (1 dia)
const TILE = 14;
const PAD_X = 12;
const PAD_TOP = 34;   // espaço para a nuvem
const PAD_BOTTOM = 26;

const CYCLE = 14;       // segundos por ciclo completo
const GROW_END = 0.62;  // fração do ciclo em que a última coluna termina de crescer
const HOLD_END = 0.92;  // começa a "colheita" (sumir) aqui

function plant(level, cx, by, seed, t) {
  const petal = pick(PETALS, seed + "p");
  const fruit = pick(FRUITS, seed + "f");
  const lean = (rand(seed + "l") - 0.5) * 1.6;
  switch (level) {
    case 1: // broto
      return `<path d="M${cx} ${by} v-4" stroke="${t.stem}" stroke-width="1.2" stroke-linecap="round"/>
        <ellipse cx="${cx - 1.8}" cy="${by - 4.2}" rx="2" ry="1.1" fill="${t.leaf}" transform="rotate(-25 ${cx - 1.8} ${by - 4.2})"/>
        <ellipse cx="${cx + 1.8}" cy="${by - 4.2}" rx="2" ry="1.1" fill="${t.leaf}" transform="rotate(25 ${cx + 1.8} ${by - 4.2})"/>`;
    case 2: // planta jovem
      return `<path d="M${cx} ${by} q${lean} -4 0 -8" stroke="${t.stem}" stroke-width="1.3" fill="none" stroke-linecap="round"/>
        <ellipse cx="${cx - 2.4}" cy="${by - 3.5}" rx="2.6" ry="1.2" fill="${t.leafDark}" transform="rotate(-30 ${cx - 2.4} ${by - 3.5})"/>
        <ellipse cx="${cx + 2.4}" cy="${by - 5}" rx="2.6" ry="1.2" fill="${t.leaf}" transform="rotate(30 ${cx + 2.4} ${by - 5})"/>
        <ellipse cx="${cx}" cy="${by - 8.5}" rx="1.3" ry="2" fill="${t.leaf}"/>`;
    case 3: { // flor
      const fy = by - 9.5;
      const petals = [0, 72, 144, 216, 288]
        .map((a) => {
          const r = (a * Math.PI) / 180;
          return `<circle cx="${(cx + Math.cos(r) * 2.1).toFixed(2)}" cy="${(fy + Math.sin(r) * 2.1).toFixed(2)}" r="1.5" fill="${petal}"/>`;
        }).join("");
      return `<path d="M${cx} ${by} q${lean} -4 0 -9" stroke="${t.stem}" stroke-width="1.3" fill="none"/>
        <ellipse cx="${cx - 2.4}" cy="${by - 3}" rx="2.6" ry="1.2" fill="${t.leafDark}" transform="rotate(-30 ${cx - 2.4} ${by - 3})"/>
        <ellipse cx="${cx + 2.4}" cy="${by - 4.5}" rx="2.6" ry="1.2" fill="${t.leaf}" transform="rotate(30 ${cx + 2.4} ${by - 4.5})"/>
        ${petals}<circle cx="${cx}" cy="${fy}" r="1.2" fill="${t.center}"/>`;
    }
    case 4: // arbusto com frutos
      return `<path d="M${cx} ${by} v-4" stroke="${t.stem}" stroke-width="1.6"/>
        <circle cx="${cx - 2.6}" cy="${by - 6}" r="3.2" fill="${t.leafDark}"/>
        <circle cx="${cx + 2.6}" cy="${by - 6}" r="3.2" fill="${t.leafDark}"/>
        <circle cx="${cx}" cy="${by - 8.6}" r="3.6" fill="${t.leaf}"/>
        <circle cx="${cx - 2.3}" cy="${by - 5.2}" r="1.4" fill="${fruit}"/>
        <circle cx="${cx + 2.5}" cy="${by - 6.4}" r="1.4" fill="${fruit}"/>
        <circle cx="${cx + 0.3}" cy="${by - 9.6}" r="1.4" fill="${fruit}"/>
        <circle cx="${cx - 2.7}" cy="${by - 5.6}" r="0.45" fill="#fff" opacity=".7"/>`;
    default:
      return "";
  }
}

function render(cal, theme) {
  const t = THEMES[theme];
  const nWeeks = cal.weeks.length;
  const W = PAD_X * 2 + nWeeks * CELL;
  const H = PAD_TOP + 7 * CELL + PAD_BOTTOM;
  const pct = (x) => (x * 100).toFixed(2) + "%";

  // uma animação por semana: a coluna cresce quando a nuvem passa por ela
  let keyframes = "";
  for (let w = 0; w < nWeeks; w++) {
    const start = (w / nWeeks) * (GROW_END - 0.06);
    const end = start + 0.06;
    keyframes += `@keyframes g${w}{0%,${pct(start)}{transform:scale(0)}${pct(end - 0.015)}{transform:scale(1.15)}${pct(end)},${pct(HOLD_END)}{transform:scale(1)}100%{transform:scale(0)}}
.w${w}{animation:g${w} ${CYCLE}s ease-out infinite}\n`;
  }

  let tiles = "";
  let plants = "";
  cal.weeks.forEach((days, w) => {
    days.forEach((d) => {
      const x = PAD_X + w * CELL;
      const y = PAD_TOP + d.weekday * CELL;
      const fill = d.level === 0 ? t.soilEmpty : t.soil;
      tiles += `<rect x="${x}" y="${y}" width="${TILE}" height="${TILE}" rx="3" fill="${fill}"><title>${d.date}: ${d.count} contribuições</title></rect>`;
      if (d.level > 0) {
        tiles += `<path d="M${x + 3} ${y + TILE - 2.5}h${TILE - 6}" stroke="${t.soilDark}" stroke-width="1" stroke-linecap="round"/>`;
        plants += `<g class="p w${w}">${plant(d.level, x + TILE / 2, y + TILE - 2.5, d.date, t)}</g>`;
      }
    });
  });

  // nuvem que passa regando o canteiro
  const cloudEnd = PAD_X + nWeeks * CELL;
  const cloud = `<g class="cloud">
    <g class="rain" stroke="${t.rain}" stroke-width="1.2" stroke-linecap="round">
      <path d="M-6 18v4"/><path d="M0 20v4"/><path d="M6 18v4"/>
    </g>
    <circle cx="-7" cy="12" r="5" fill="${t.cloud}" stroke="${t.cloudEdge}"/>
    <circle cx="7" cy="12" r="5" fill="${t.cloud}" stroke="${t.cloudEdge}"/>
    <circle cx="0" cy="8" r="7" fill="${t.cloud}" stroke="${t.cloudEdge}"/>
    <rect x="-7" y="10" width="14" height="7" fill="${t.cloud}"/>
  </g>`;

  const harvest = cal.weeks.flat().filter((d) => d.level === 4).length;
  const label = `${cal.total} contribuições no último ano · ${harvest} dias de colheita`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<style>
.p{transform-box:fill-box;transform-origin:50% 100%}
${keyframes}
@keyframes move{0%{transform:translateX(${PAD_X - 20}px)}${pct(GROW_END)}{transform:translateX(${cloudEnd + 10}px)}${pct(GROW_END + 0.001)},100%{transform:translateX(${W + 40}px)}}
.cloud{animation:move ${CYCLE}s linear infinite}
@keyframes drop{0%{transform:translateY(-2px);opacity:0}50%{opacity:1}100%{transform:translateY(4px);opacity:0}}
.rain{animation:drop .6s linear infinite}
text{font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;fill:${t.text}}
</style>
${tiles}
${plants}
${cloud}
<text x="${PAD_X}" y="${H - 8}">${label}</text>
</svg>`;
}

// ---------- main ----------
(async () => {
  if (!DEMO && !USER) throw new Error("Informe --user seu-usuario (ou use --demo).");
  const cal = DEMO ? demoCalendar() : await fetchCalendar(USER);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "farm.svg"), render(cal, "light"));
  fs.writeFileSync(path.join(OUT, "farm-dark.svg"), render(cal, "dark"));
  console.log(`Fazenda gerada em ${OUT}/ (${cal.total} contribuições)`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
