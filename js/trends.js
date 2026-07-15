const v = globalThis.__ECAL_V__ ?? "4";

const { fetchJson } = await import(`./fetch-json.js?v=${v}`);

const SERIES_COLORS = [
  "#5b9fd4",
  "#e8a838",
  "#7dcea0",
  "#c39bd3",
  "#f1948a",
];

let trendsData = null;

export async function loadTrendsData(fetcher = fetchJson) {
  try {
    trendsData = await fetcher("data/trends.json");
  } catch {
    trendsData = { races: [], generated_at: null };
  }
  return trendsData;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatLongDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T12:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function locationLine(race) {
  const parts = [];
  if (race.state_code === "CO") parts.push("Colorado");
  else if (race.state_code) parts.push(race.state_code);
  if (race.country_code === "US") parts.push("US");
  else if (race.country_code) parts.push(race.country_code);
  return parts.join(" · ");
}

function linePath(points) {
  if (!points.length) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
}

function buildChart(race) {
  const series = race.series || [];
  const candidates = race.candidates || [];
  if (!series.length || !candidates.length) {
    return `<p class="trends-empty">No search-interest series for this race yet.</p>`;
  }

  const width = 640;
  const height = 240;
  const pad = { top: 16, right: 16, bottom: 36, left: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = series.length;
  const xAt = (i) => pad.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (value) => pad.top + plotH - (Math.max(0, Math.min(100, value)) / 100) * plotH;

  const yTicks = [0, 25, 50, 75, 100];
  const grid = yTicks
    .map((tick) => {
      const y = yAt(tick);
      return `
        <line class="trends-grid" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" />
        <text class="trends-axis-label" x="${pad.left - 8}" y="${y + 3}" text-anchor="end">${tick}</text>
      `;
    })
    .join("");

  const xLabelIndexes = new Set([0, Math.floor((n - 1) / 2), n - 1].filter((i) => i >= 0));
  const xLabels = [...xLabelIndexes]
    .map((i) => {
      const x = xAt(i);
      return `<text class="trends-axis-label" x="${x}" y="${height - 10}" text-anchor="middle">${escapeHtml(formatShortDate(series[i].date))}</text>`;
    })
    .join("");

  const paths = candidates
    .map((candidate, cIdx) => {
      const color = SERIES_COLORS[cIdx % SERIES_COLORS.length];
      const points = series.map((point, i) => {
        const raw = point.values?.[candidate.keyword];
        const value = typeof raw === "number" ? raw : 0;
        return { x: xAt(i), y: yAt(value), value };
      });
      return `
        <path
          class="trends-line"
          d="${linePath(points)}"
          fill="none"
          stroke="${color}"
          stroke-width="2.25"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      `;
    })
    .join("");

  const legend = candidates
    .map((candidate, cIdx) => {
      const color = SERIES_COLORS[cIdx % SERIES_COLORS.length];
      const typeHint = candidate.topic_type
        ? ` <span class="trends-legend-type">${escapeHtml(candidate.topic_type)}</span>`
        : "";
      return `
        <span class="trends-legend-item">
          <span class="trends-swatch" style="background:${color}"></span>
          ${escapeHtml(candidate.label || candidate.keyword)}${typeHint}
        </span>
      `;
    })
    .join("");

  return `
    <div class="trends-chart-wrap" role="img" aria-label="Google Trends interest over time for ${escapeHtml(race.title)}">
      <svg class="trends-chart" viewBox="0 0 ${width} ${height}" width="100%" height="auto" preserveAspectRatio="xMidYMid meet">
        ${grid}
        ${paths}
        ${xLabels}
      </svg>
      <div class="trends-legend">${legend}</div>
    </div>
  `;
}

function footnoteForRace(race) {
  const usesEntities = (race.candidates || []).some(
    (c) => c.query_mode === "entity" || c.mid
  );
  const basis = usesEntities
    ? "Google Trends person topics (0–100, relative within this comparison)"
    : "Google Trends search interest (0–100, relative within this comparison)";
  return `${basis}. Daily series for the ${race.window_days || 30} days through election day.`;
}

function renderRaceCard(race) {
  const subtitle = [
    locationLine(race),
    race.election_date ? `Race day ${formatLongDate(race.election_date)}` : null,
    race.window_days ? `${race.window_days}-day run-up` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return `
    <article class="trends-card">
      <header class="trends-card-header">
        <h3 class="trends-card-title">${escapeHtml(race.title)}</h3>
        <p class="trends-card-meta">${escapeHtml(subtitle)}</p>
      </header>
      ${buildChart(race)}
      <p class="trends-footnote">${escapeHtml(footnoteForRace(race))}</p>
    </article>
  `;
}

export async function renderTrends(container) {
  if (!container) return;

  const races = trendsData?.races || [];
  if (!races.length) {
    const updated = trendsData?.generated_at
      ? `Last checked ${trendsData.generated_at}. `
      : "";
    container.innerHTML = `<p class="empty">${updated}No Google Trends race data yet.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="trends-intro">
      <p>Search interest from Google Trends for recent races. Where possible, comparisons use Google’s person topics (not raw name strings) so each series maps to one candidate. Values are relative within each head-to-head comparison (peak = 100).</p>
    </div>
    <div class="trends-list">
      ${races.map(renderRaceCard).join("")}
    </div>
  `;
}

export function trendsFooterText() {
  if (!trendsData?.generated_at) return "";
  const count = trendsData.races?.length || 0;
  return `Trends updated ${trendsData.generated_at} · ${count} race${count === 1 ? "" : "s"}`;
}
