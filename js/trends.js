const v = globalThis.__ECAL_V__ ?? "4";

const { fetchJson } = await import(`./fetch-json.js?v=${v}`);

const SERIES_COLORS = [
  "#5b9fd4",
  "#e8a838",
  "#7dcea0",
  "#c39bd3",
  "#f1948a",
];

const CHART = {
  width: 640,
  height: 260,
  pad: { top: 16, right: 16, bottom: 36, left: 36 },
};

let trendsData = null;
let selectedRaceId = null;

export async function loadTrendsData(fetcher = fetchJson) {
  try {
    trendsData = await fetcher("data/trends.json");
  } catch {
    trendsData = { races: [], generated_at: null };
  }
  const races = trendsData?.races || [];
  if (!races.some((race) => race.id === selectedRaceId)) {
    selectedRaceId = races[0]?.id ?? null;
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

function electionYearShort(race) {
  const iso = race.election_date || "";
  return /^\d{4}/.test(iso) ? iso.slice(2, 4) : "";
}

/** Compact race tag for dropdowns, e.g. "CO US Senate 26". */
function raceShortTag(race) {
  if (race.short_label) return String(race.short_label);
  const parts = [];
  if (race.state_code) parts.push(race.state_code);

  const title = race.title || "";
  const cdMatch = title.match(/\bCD[-\s]?(\d+)\b/i);
  if (cdMatch) {
    parts.push(`CD-${cdMatch[1]}`);
  } else if (/\bsenate\b/i.test(title)) {
    parts.push(race.country_code === "US" || !race.country_code ? "US Senate" : "Senate");
  } else if (/\bgovernor\b/i.test(title)) {
    parts.push(race.country_code === "US" || !race.country_code ? "US Governor" : "Governor");
  } else {
    const trimmed = title
      .replace(/\bColorado\b/gi, "")
      .replace(/\bDemocratic\b/gi, "")
      .replace(/\bRepublican\b/gi, "")
      .replace(/\bPrimary\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (trimmed) parts.push(trimmed);
  }

  const yy = electionYearShort(race);
  if (yy) parts.push(yy);
  return parts.join(" ");
}

function candidateShortName(candidate) {
  return candidate?.label || candidate?.name || candidate?.keyword || "Candidate";
}

function linePath(points) {
  if (!points.length) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
}

function candidateDisplayName(candidate) {
  return candidateShortName(candidate);
}

function formatVotePct(pct) {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return "—";
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function resultStatusHeading(status) {
  switch (String(status || "").toLowerCase()) {
    case "official":
      return "Official result";
    case "preliminary":
      return "Preliminary result";
    case "current":
      return "Current result";
    default:
      return "Result";
  }
}

/** Match a curated result candidate to a Trends series row (label / name). */
function resultPctForCandidate(result, candidate) {
  const rows = result?.candidates || [];
  if (!rows.length || !candidate) return null;
  const label = String(candidate.label || "").toLowerCase();
  const name = String(candidate.name || "").toLowerCase();
  const hit =
    rows.find((row) => String(row.label || "").toLowerCase() === label) ||
    rows.find((row) => String(row.name || "").toLowerCase() === name) ||
    rows.find(
      (row) =>
        name &&
        String(row.name || "")
          .toLowerCase()
          .includes(name)
    ) ||
    rows.find(
      (row) =>
        label &&
        String(row.label || "")
          .toLowerCase()
          .includes(label)
    );
  return typeof hit?.pct === "number" ? hit.pct : null;
}

/**
 * Relative share of displayed search interest (area under each series),
 * normalized so integer percents sum to 100.
 */
function computeRelativeShares(candidateSeries) {
  const rows = (candidateSeries || []).map(({ candidate, color, points }) => {
    const sum = (points || []).reduce((acc, point) => {
      const value = typeof point.value === "number" ? point.value : 0;
      return acc + Math.max(0, value);
    }, 0);
    return {
      label: candidateShortName(candidate),
      color,
      sum,
    };
  });
  const total = rows.reduce((acc, row) => acc + row.sum, 0);
  if (!rows.length || total <= 0) {
    return rows.map((row) => ({ ...row, share: 0 }));
  }

  const exact = rows.map((row) => (row.sum / total) * 100);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = 100 - floors.reduce((acc, value) => acc + value, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - floors[index] }))
    .sort((a, b) => b.frac - a.frac);
  const shares = [...floors];
  for (let i = 0; i < order.length && remainder > 0; i++, remainder--) {
    shares[order[i].index] += 1;
  }
  return rows.map((row, index) => ({ ...row, share: shares[index] }));
}

function buildShareItems(rows) {
  return rows
    .map(
      (row) => `
        <span class="trends-share-item">
          <span class="trends-swatch" style="background:${row.color}"></span>
          <span class="trends-share-label">${escapeHtml(row.label)}</span>
          <span class="trends-share-value">${escapeHtml(row.value)}</span>
        </span>
      `
    )
    .join('<span class="trends-share-sep" aria-hidden="true">·</span>');
}

function buildShareSummary(candidateSeries, race) {
  const shares = computeRelativeShares(candidateSeries);
  if (!shares.length) return "";
  const total = shares.reduce((acc, row) => acc + row.sum, 0);
  const days = race?.window_days || 30;

  let searchBlock;
  if (total <= 0) {
    searchBlock = `<p class="trends-split">No cumulative search interest in this window.</p>`;
  } else {
    const searchRows = shares.map((row) => ({
      label: row.label,
      color: row.color,
      value: `${row.share}%`,
    }));
    searchBlock = `
      <div class="trends-split">
        <span class="trends-split-heading">Search share (${days}d)</span>
        <span class="trends-share-row">${buildShareItems(searchRows)}</span>
      </div>
    `;
  }

  const result = race?.result;
  let resultBlock = "";
  if (result?.candidates?.length) {
    const resultRows = (candidateSeries || [])
      .map(({ candidate, color }) => {
        const pct = resultPctForCandidate(result, candidate);
        if (pct == null) return null;
        return {
          label: candidateShortName(candidate),
          color,
          value: formatVotePct(pct),
        };
      })
      .filter(Boolean);
    if (resultRows.length) {
      resultBlock = `
        <div class="trends-split">
          <span class="trends-split-heading">${escapeHtml(resultStatusHeading(result.status))}</span>
          <span class="trends-share-row">${buildShareItems(resultRows)}</span>
        </div>
      `;
    }
  }

  return `<div class="trends-splits">${searchBlock}${resultBlock}</div>`;
}

function buildChartModel(race) {
  const series = race.series || [];
  const candidates = race.candidates || [];
  const { width, height, pad } = CHART;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = series.length;
  const xAt = (i) => pad.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (value) => pad.top + plotH - (Math.max(0, Math.min(100, value)) / 100) * plotH;

  const candidateSeries = candidates.map((candidate, cIdx) => {
    const color = SERIES_COLORS[cIdx % SERIES_COLORS.length];
    const points = series.map((point, i) => {
      const raw = point.values?.[candidate.keyword];
      const value = typeof raw === "number" ? raw : 0;
      return {
        date: point.date,
        value,
        x: xAt(i),
        y: yAt(value),
      };
    });
    return { candidate, color, points };
  });

  return { width, height, pad, plotW, plotH, xAt, yAt, series, candidateSeries };
}

function buildChartSvg(model) {
  const { width, height, pad, series, candidateSeries, yAt } = model;
  const n = series.length;

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
      const x = model.xAt(i);
      return `<text class="trends-axis-label" x="${x}" y="${height - 10}" text-anchor="middle">${escapeHtml(formatShortDate(series[i].date))}</text>`;
    })
    .join("");

  const paths = candidateSeries
    .map(
      ({ color, points }) => `
        <path
          class="trends-line"
          d="${linePath(points)}"
          fill="none"
          stroke="${color}"
          stroke-width="2.25"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      `
    )
    .join("");

  return `
    <svg class="trends-chart" viewBox="0 0 ${width} ${height}" width="100%" height="auto" preserveAspectRatio="xMidYMid meet">
      ${grid}
      ${paths}
      ${xLabels}
      <line class="trends-hover-line" x1="0" y1="${pad.top}" x2="0" y2="${height - pad.bottom}" hidden />
      <g class="trends-hover-dots"></g>
      <rect
        class="trends-hover-capture"
        x="${pad.left}"
        y="${pad.top}"
        width="${model.plotW}"
        height="${model.plotH}"
        fill="transparent"
      />
    </svg>
  `;
}

function buildLegend(candidateSeries) {
  return candidateSeries
    .map(
      ({ candidate, color }) => `
        <span class="trends-legend-item">
          <span class="trends-swatch" style="background:${color}"></span>
          <span class="trends-legend-text">${escapeHtml(candidateDisplayName(candidate))}</span>
        </span>
      `
    )
    .join("");
}

function nearestIndex(model, clientX, svg) {
  const rect = svg.getBoundingClientRect();
  if (!rect.width) return 0;
  const svgX = ((clientX - rect.left) / rect.width) * model.width;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < model.series.length; i++) {
    const dist = Math.abs(model.xAt(i) - svgX);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function updateHover(wrap, model, index) {
  const svg = wrap.querySelector(".trends-chart");
  const tooltip = wrap.querySelector(".trends-tooltip");
  const hoverLine = svg?.querySelector(".trends-hover-line");
  const dots = svg?.querySelector(".trends-hover-dots");
  if (!svg || !tooltip || !hoverLine || !dots) return;

  const point = model.series[index];
  if (!point) {
    clearHover(wrap);
    return;
  }

  const x = model.xAt(index);
  hoverLine.setAttribute("x1", String(x));
  hoverLine.setAttribute("x2", String(x));
  hoverLine.hidden = false;

  dots.innerHTML = model.candidateSeries
    .map(({ color, points }) => {
      const pt = points[index];
      return `<circle cx="${pt.x}" cy="${pt.y}" r="4" fill="${color}" stroke="#fff" stroke-width="1.5" />`;
    })
    .join("");

  const rows = model.candidateSeries
    .map(({ candidate, color, points }) => {
      const value = points[index]?.value ?? 0;
      return `
        <div class="trends-tooltip-row">
          <span class="trends-tooltip-swatch" style="background:${color}"></span>
          <span class="trends-tooltip-label">${escapeHtml(candidate.label || candidate.name || "Candidate")}</span>
          <span class="trends-tooltip-value">${value}</span>
        </div>
      `;
    })
    .join("");

  tooltip.innerHTML = `
    <div class="trends-tooltip-date">${escapeHtml(formatLongDate(point.date))}</div>
    ${rows}
  `;
  tooltip.hidden = false;

  const plotLeft = model.pad.left;
  const plotRight = model.width - model.pad.right;
  const preferRight = x < (plotLeft + plotRight) / 2;
  const leftPct = (x / model.width) * 100;
  tooltip.style.left = `${leftPct}%`;
  tooltip.style.transform = preferRight
    ? "translate(12px, -50%)"
    : "translate(calc(-100% - 12px), -50%)";
  tooltip.style.top = "42%";
}

function clearHover(wrap) {
  const svg = wrap.querySelector(".trends-chart");
  const tooltip = wrap.querySelector(".trends-tooltip");
  const hoverLine = svg?.querySelector(".trends-hover-line");
  const dots = svg?.querySelector(".trends-hover-dots");
  if (hoverLine) hoverLine.hidden = true;
  if (dots) dots.innerHTML = "";
  if (tooltip) {
    tooltip.hidden = true;
    tooltip.innerHTML = "";
  }
}

function wireChartInteractions(wrap, model) {
  const svg = wrap.querySelector(".trends-chart");
  const capture = svg?.querySelector(".trends-hover-capture");
  if (!svg || !capture || !model.series.length) return;

  const onMove = (event) => {
    const index = nearestIndex(model, event.clientX, svg);
    updateHover(wrap, model, index);
  };
  const onLeave = () => clearHover(wrap);

  capture.addEventListener("pointermove", onMove);
  capture.addEventListener("pointerdown", onMove);
  capture.addEventListener("pointerleave", onLeave);
  capture.addEventListener("blur", onLeave);
}

function renderRaceCard(race) {
  const subtitle = [
    locationLine(race),
    race.election_date ? `Race day ${formatLongDate(race.election_date)}` : null,
    race.window_days ? `${race.window_days}-day run-up` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const model = buildChartModel(race);
  if (!model.series.length || !model.candidateSeries.length) {
    return `
      <article class="trends-card" data-race-id="${escapeHtml(race.id)}">
        <header class="trends-card-header">
          <h3 class="trends-card-title">${escapeHtml(race.title)}</h3>
          <p class="trends-card-meta">${escapeHtml(subtitle)}</p>
        </header>
        <p class="trends-empty">No search-interest series for this race yet.</p>
      </article>
    `;
  }

  return `
    <article class="trends-card" data-race-id="${escapeHtml(race.id)}">
      <header class="trends-card-header">
        <h3 class="trends-card-title">${escapeHtml(race.title)}</h3>
        <p class="trends-card-meta">${escapeHtml(subtitle)}</p>
      </header>
      ${buildShareSummary(model.candidateSeries, race)}
      <div class="trends-chart-wrap" data-chart-root>
        ${buildChartSvg(model)}
        <div class="trends-tooltip" hidden></div>
        <div class="trends-legend">${buildLegend(model.candidateSeries)}</div>
      </div>
    </article>
  `;
}

/** Dropdown label: "Hickenlooper - Gonzales (CO US Senate 26)". */
function raceOptionLabel(race) {
  const names = (race.candidates || [])
    .map((candidate) => candidateShortName(candidate))
    .filter((name) => name && name !== "Candidate");
  const tag = raceShortTag(race);
  if (names.length && tag) return `${names.join(" - ")} (${tag})`;
  if (names.length) return names.join(" - ");
  return tag || race.title || race.id || "Race";
}

function bindInteractions(container, races) {
  const select = container.querySelector("[data-trends-race-select]");
  if (select) {
    select.addEventListener("change", () => {
      selectedRaceId = select.value;
      renderTrends(container);
    });
  }

  for (const race of races) {
    const card = container.querySelector(`[data-race-id="${CSS.escape(race.id)}"]`);
    const wrap = card?.querySelector("[data-chart-root]");
    if (!wrap) continue;
    const model = buildChartModel(race);
    if (!model.series.length) continue;
    wireChartInteractions(wrap, model);
  }
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

  if (!races.some((race) => race.id === selectedRaceId)) {
    selectedRaceId = races[0].id;
  }
  const activeRace = races.find((race) => race.id === selectedRaceId) || races[0];

  const options = races
    .map(
      (race) => `
        <option value="${escapeHtml(race.id)}"${race.id === activeRace.id ? " selected" : ""}>
          ${escapeHtml(raceOptionLabel(race))}
        </option>
      `
    )
    .join("");

  container.innerHTML = `
    <div class="trends-toolbar">
      <label class="trends-race-label" for="trends-race-select">Race</label>
      <select id="trends-race-select" class="trends-race-select" data-trends-race-select>
        ${options}
      </select>
    </div>
    <div class="trends-list">
      ${renderRaceCard(activeRace)}
    </div>
  `;

  bindInteractions(container, [activeRace]);
}

export function trendsFooterText() {
  if (!trendsData?.generated_at) return "";
  const count = trendsData.races?.length || 0;
  return `Trends updated ${trendsData.generated_at} · ${count} race${count === 1 ? "" : "s"}`;
}
