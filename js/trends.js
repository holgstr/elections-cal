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

const SCATTER = {
  width: 640,
  height: 300,
  pad: { top: 18, right: 18, bottom: 44, left: 48 },
};

let trendsData = null;
let selectedRaceId = null;

export async function loadTrendsData(fetcher = fetchJson) {
  try {
    trendsData = await fetcher("data/trends.json");
  } catch {
    trendsData = { races: [], generated_at: null };
  }
  const races = visibleRaces(trendsData?.races);
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

/** Scatter-plot race title from given names, e.g. "Weiser-Bennet". */
function raceGivenNamesTitle(race) {
  const names = (race?.candidates || [])
    .map((candidate) => candidateShortName(candidate))
    .filter((name) => name && name !== "Candidate");
  if (names.length) return names.join("-");
  return raceShortTag(race) || race?.title || race?.id || "Race";
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

/** Days used for relative search share: pre-election only (not race day). */
function searchShareDays(race) {
  const windowDays = race?.window_days || 30;
  return Math.max(1, windowDays - 1);
}

/**
 * Points for search-share area: the shareDays before election day
 * (election day itself is omitted).
 */
function pointsForSearchShare(points, electionDate, shareDays) {
  const all = points || [];
  if (!electionDate) {
    return shareDays > 0 ? all.slice(-shareDays) : all;
  }
  const before = all.filter((point) => point.date && point.date < electionDate);
  if (before.length <= shareDays) return before;
  return before.slice(-shareDays);
}

/**
 * Relative share of displayed search interest (area under each series),
 * normalized so integer percents sum to 100. Uses pre-election days only.
 */
function computeRelativeShares(candidateSeries, race) {
  const electionDate = race?.election_date || null;
  const shareDays = searchShareDays(race);
  const rows = (candidateSeries || []).map(({ candidate, color, points }) => {
    const sharePoints = pointsForSearchShare(points, electionDate, shareDays);
    const sum = sharePoints.reduce((acc, point) => {
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

/**
 * Relative result shares among Trends-tracked candidates only, rescaled to
 * 100 so third-party / untracked vote is excluded from the comparison.
 */
function computeRelativeResults(race, candidateSeries) {
  const result = race?.result;
  if (!result?.candidates?.length || !candidateSeries?.length) return [];

  const rows = candidateSeries
    .map(({ candidate, color }) => {
      const pct = resultPctForCandidate(result, candidate);
      if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0) return null;
      return {
        label: candidateShortName(candidate),
        color,
        candidate,
        raw: pct,
      };
    })
    .filter(Boolean);

  const total = rows.reduce((acc, row) => acc + row.raw, 0);
  if (!rows.length || total <= 0) return [];

  return rows.map((row) => ({
    ...row,
    share: (row.raw / total) * 100,
  }));
}

/**
 * One point per dropdown race: tracked vote winner’s search share (x) vs
 * relative result share (y). Both axes are among Trends-tracked candidates.
 * Races marked exclude (primary clearly won’t decide the office) are omitted.
 */
function buildRaceCorrelationPoints(races) {
  const points = [];
  for (const race of races || []) {
    if (isRaceExcluded(race)) continue;
    const model = buildChartModel(race);
    if (!model.series.length || !model.candidateSeries.length) continue;

    const searchShares = computeRelativeShares(model.candidateSeries, race);
    const resultShares = computeRelativeResults(race, model.candidateSeries);
    if (!searchShares.length || !resultShares.length) continue;

    const searchTotal = searchShares.reduce((acc, row) => acc + row.sum, 0);
    if (searchTotal <= 0) continue;

    const winner = resultShares.reduce((best, row) =>
      !best || row.share > best.share ? row : best
    );
    const searchWinner = searchShares.reduce((best, row) =>
      !best || row.share > best.share ? row : best
    );
    const searchRow = searchShares.find((row) => row.label === winner.label);
    if (!searchRow || !searchWinner) continue;

    const predicted = searchWinner.label === winner.label;
    points.push({
      raceId: race.id,
      raceLabel: raceGivenNamesTitle(race),
      raceTitle: raceGivenNamesTitle(race),
      candidateLabel: winner.label,
      searchWinnerLabel: searchWinner.label,
      predicted,
      color: predicted ? "#2f9e44" : "#e03131",
      x: searchRow.share,
      y: winner.share,
      resultStatus: race.result?.status || null,
    });
  }
  return points;
}

/** True when the race is marked as irrelevant to who wins the office. */
function isRaceExcluded(race) {
  return Boolean(race?.exclude && typeof race.exclude === "object");
}

/** Races shown in the Trends dropdown (excludes clear non-deciding primaries). */
function visibleRaces(races) {
  return (races || []).filter((race) => !isRaceExcluded(race));
}

function pearsonCorrelation(points) {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXX += point.x * point.x;
    sumYY += point.y * point.y;
    sumXY += point.x * point.y;
  }
  const denomX = n * sumXX - sumX * sumX;
  const denomY = n * sumYY - sumY * sumY;
  if (denomX <= 0 || denomY <= 0) return null;
  return (n * sumXY - sumX * sumY) / Math.sqrt(denomX * denomY);
}

/** Average ranks for ties; ranks are 1-based. */
function averageRanks(values) {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i + 1;
    while (j < indexed.length && indexed[j].value === indexed[i].value) j += 1;
    const avg = (i + 1 + j) / 2;
    for (let k = i; k < j; k += 1) ranks[indexed[k].index] = avg;
    i = j;
  }
  return ranks;
}

function spearmanCorrelation(points) {
  const n = points.length;
  if (n < 2) return null;
  const rankX = averageRanks(points.map((point) => point.x));
  const rankY = averageRanks(points.map((point) => point.y));
  return pearsonCorrelation(
    rankX.map((x, index) => ({ x, y: rankY[index] }))
  );
}

/** Ordinary least-squares line: y = intercept + slope * x */
function fitLinearModel(points) {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
    sumXX += point.x * point.x;
    sumXY += point.x * point.y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const r = pearsonCorrelation(points);
  const r2 = r == null ? null : r * r;
  const spearman = spearmanCorrelation(points);
  return { slope, intercept, r2, spearman, n };
}

function formatCorr(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const fixed = value.toFixed(2);
  return fixed.startsWith("-") ? fixed : fixed;
}

/**
 * Data-driven axis domain with padding, clamped to [hardMin, hardMax].
 * Keeps a minimum span so a cluster of similar points still has room to breathe.
 * Tick marks are nice round values inside that zoomed domain.
 */
function paddedDomain(
  values,
  { padRatio = 0.12, hardMin = 0, hardMax = 100, minSpan = 12, tickCount = 5 } = {}
) {
  const nums = (values || []).filter(
    (value) => typeof value === "number" && Number.isFinite(value)
  );
  if (!nums.length) {
    return { min: hardMin, max: hardMax, ticks: niceTicks(hardMin, hardMax, tickCount) };
  }

  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (max - min < minSpan) {
    const mid = (min + max) / 2;
    min = mid - minSpan / 2;
    max = mid + minSpan / 2;
  }

  const pad = (max - min) * padRatio;
  min = Math.max(hardMin, min - pad);
  max = Math.min(hardMax, max + pad);

  if (max - min < minSpan) {
    if (min <= hardMin + 1e-9) {
      min = hardMin;
      max = Math.min(hardMax, hardMin + minSpan);
    } else if (max >= hardMax - 1e-9) {
      max = hardMax;
      min = Math.max(hardMin, hardMax - minSpan);
    }
  }

  return { min, max, ticks: niceTicks(min, max, tickCount) };
}

/** Nice tick marks covering [min, max] (about `count` ticks). */
function niceTicks(min, max, count = 5) {
  if (!(max > min) || count < 2) return [min, max];
  const span = max - min;
  const rawStep = span / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1e-9)));
  const candidates = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude);
  // Also consider one magnitude finer so dense ranges still get readable ticks.
  if (magnitude >= 1) {
    for (const factor of [1, 2, 2.5, 5]) candidates.push(factor * (magnitude / 10));
  }

  let best = null;
  for (const step of candidates) {
    if (!(step > 0)) continue;
    const start = Math.ceil((min - 1e-9) / step) * step;
    const ticks = [];
    for (let value = start; value <= max + step * 1e-9; value += step) {
      let rounded = Math.round(value / step) * step;
      if (Object.is(rounded, -0) || Math.abs(rounded) < 1e-12) rounded = 0;
      if (rounded >= min - 1e-9 && rounded <= max + 1e-9) ticks.push(rounded);
    }
    if (ticks.length < 2) continue;
    // Prefer ~count ticks; lightly penalize overcrowding or sparsity.
    const score = Math.abs(ticks.length - count) + (ticks.length > count + 2 ? ticks.length - count : 0);
    if (!best || score < best.score) best = { ticks, score };
  }
  return best?.ticks ?? [min, max];
}

function formatAxisTick(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function buildShareSummary(candidateSeries, race) {
  const shares = computeRelativeShares(candidateSeries, race);
  if (!shares.length) return "";
  const total = shares.reduce((acc, row) => acc + row.sum, 0);
  const days = searchShareDays(race);

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

  const shareDays = searchShareDays(race);
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
      <p class="trends-share-footnote">Search share excludes election day (${shareDays}d prior).</p>
    </article>
  `;
}

function buildCorrelationScatterSvg(points, modelFit) {
  const { width, height, pad } = SCATTER;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const xDomain = paddedDomain(points.map((point) => point.x));
  const yDomain = paddedDomain(points.map((point) => point.y));
  const xSpan = Math.max(1e-9, xDomain.max - xDomain.min);
  const ySpan = Math.max(1e-9, yDomain.max - yDomain.min);
  const xAt = (value) =>
    pad.left + ((Math.max(xDomain.min, Math.min(xDomain.max, value)) - xDomain.min) / xSpan) * plotW;
  const yAt = (value) =>
    pad.top +
    plotH -
    ((Math.max(yDomain.min, Math.min(yDomain.max, value)) - yDomain.min) / ySpan) * plotH;

  const xTicks = xDomain.ticks?.length ? xDomain.ticks : niceTicks(xDomain.min, xDomain.max);
  const yTicks = yDomain.ticks?.length ? yDomain.ticks : niceTicks(yDomain.min, yDomain.max);
  const hGrid = yTicks
    .map((tick) => {
      const y = yAt(tick);
      return `
        <line class="trends-grid" x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" />
        <text class="trends-axis-label" x="${pad.left - 8}" y="${y + 3}" text-anchor="end">${formatAxisTick(tick)}</text>
      `;
    })
    .join("");
  const vGrid = xTicks
    .map((tick) => {
      const x = xAt(tick);
      return `
        <line class="trends-grid" x1="${x}" y1="${pad.top}" x2="${x}" y2="${height - pad.bottom}" />
        <text class="trends-axis-label" x="${x}" y="${height - 14}" text-anchor="middle">${formatAxisTick(tick)}</text>
      `;
    })
    .join("");
  const grid = `${hGrid}${vGrid}`;

  let lmPath = "";
  if (modelFit) {
    const { min: xMin, max: xMax } = xDomain;
    const { min: yMin, max: yMax } = yDomain;
    const yAtXMin = modelFit.intercept + modelFit.slope * xMin;
    const yAtXMax = modelFit.intercept + modelFit.slope * xMax;
    // Clip the line segment to the zoomed plot box.
    const segments = [];
    const candidates = [
      { x: xMin, y: yAtXMin },
      { x: xMax, y: yAtXMax },
    ];
    // Intersections with yMin and yMax when slope is non-zero.
    if (Math.abs(modelFit.slope) > 1e-12) {
      candidates.push({ x: (yMin - modelFit.intercept) / modelFit.slope, y: yMin });
      candidates.push({ x: (yMax - modelFit.intercept) / modelFit.slope, y: yMax });
    }
    for (const pt of candidates) {
      if (
        pt.x >= xMin - 1e-9 &&
        pt.x <= xMax + 1e-9 &&
        pt.y >= yMin - 1e-9 &&
        pt.y <= yMax + 1e-9
      ) {
        segments.push({
          x: Math.max(xMin, Math.min(xMax, pt.x)),
          y: Math.max(yMin, Math.min(yMax, pt.y)),
        });
      }
    }
    segments.sort((a, b) => a.x - b.x || a.y - b.y);
    const unique = [];
    for (const pt of segments) {
      const prev = unique[unique.length - 1];
      if (!prev || Math.abs(prev.x - pt.x) > 1e-6 || Math.abs(prev.y - pt.y) > 1e-6) {
        unique.push(pt);
      }
    }
    if (unique.length >= 2) {
      const a = unique[0];
      const b = unique[unique.length - 1];
      lmPath = `
        <line
          class="trends-lm-line"
          x1="${xAt(a.x)}"
          y1="${yAt(a.y)}"
          x2="${xAt(b.x)}"
          y2="${yAt(b.y)}"
        />
      `;
    }
  }

  const dots = points
    .map((point, index) => {
      const selected = point.raceId === selectedRaceId ? " is-selected" : "";
      return `
        <circle
          class="trends-scatter-dot${selected}"
          data-scatter-index="${index}"
          cx="${xAt(point.x).toFixed(1)}"
          cy="${yAt(point.y).toFixed(1)}"
          r="${point.raceId === selectedRaceId ? 6.5 : 5.5}"
          fill="${point.color}"
          stroke="#fff"
          stroke-width="1.5"
        />
      `;
    })
    .join("");

  const labels = points
    .map((point) => {
      const x = xAt(point.x);
      const y = yAt(point.y);
      const above = y > pad.top + 18;
      return `
        <text
          class="trends-scatter-label"
          x="${x.toFixed(1)}"
          y="${(above ? y - 10 : y + 16).toFixed(1)}"
          text-anchor="middle"
        >${escapeHtml(point.raceLabel)}</text>
      `;
    })
    .join("");

  return `
    <svg class="trends-chart trends-scatter-chart" viewBox="0 0 ${width} ${height}" width="100%" height="auto" preserveAspectRatio="xMidYMid meet" data-scatter-root>
      ${grid}
      ${lmPath}
      ${dots}
      ${labels}
      <text class="trends-axis-title" x="${pad.left + plotW / 2}" y="${height - 2}" text-anchor="middle">Search share (%)</text>
      <text class="trends-axis-title" x="14" y="${pad.top + plotH / 2}" text-anchor="middle" transform="rotate(-90 14 ${pad.top + plotH / 2})">Result share (%)</text>
    </svg>
  `;
}

function buildCorrelationPanel(races) {
  const points = buildRaceCorrelationPoints(races);
  if (points.length < 1) {
    return `
      <section class="trends-correlation" aria-label="Search share versus result">
        <header class="trends-card-header">
          <h3 class="trends-card-title">Search share vs result</h3>
          <p class="trends-card-meta">One point per race once preliminary or official results are available.</p>
        </header>
        <p class="trends-empty">No race results yet to compare with search share.</p>
      </section>
    `;
  }

  const modelFit = fitLinearModel(points);
  const corrReady =
    modelFit && modelFit.r2 != null && modelFit.spearman != null;
  const corrText = !corrReady
    ? points.length < 2
      ? "Need at least two races for correlation."
      : "Correlation undefined (no variance)."
    : `R² = ${formatCorr(modelFit.r2)} · Spearman ρ = ${formatCorr(modelFit.spearman)} · n = ${modelFit.n}`;

  return `
    <section class="trends-correlation" aria-label="Search share versus result">
      <header class="trends-card-header">
        <h3 class="trends-card-title">Search share vs result</h3>
        <p class="trends-card-meta">Each point is one race’s tracked winner: search share vs result (rescaled to 100%). Green = search share also picked the winner; red = miss. Omits primaries that clearly do not decide who wins the office.</p>
      </header>
      <p class="trends-corr-stat">${escapeHtml(corrText)}</p>
      <div class="trends-chart-wrap trends-scatter-wrap" data-scatter-chart-root>
        ${buildCorrelationScatterSvg(points, modelFit)}
        <div class="trends-tooltip" hidden></div>
      </div>
    </section>
  `;
}

function wireScatterInteractions(container, races) {
  const wrap = container.querySelector("[data-scatter-chart-root]");
  const svg = wrap?.querySelector("[data-scatter-root]");
  const tooltip = wrap?.querySelector(".trends-tooltip");
  if (!wrap || !svg || !tooltip) return;

  const points = buildRaceCorrelationPoints(races);

  const showTip = (index, clientX) => {
    const point = points[index];
    if (!point) return;
    const rect = svg.getBoundingClientRect();
    const pctX = rect.width ? ((clientX - rect.left) / rect.width) * 100 : 50;
    const call = point.predicted ? "Hit" : "Miss";
    tooltip.hidden = false;
    tooltip.classList.add("is-dense");
    tooltip.innerHTML = `
      <div class="trends-tooltip-dense-title">
        <span class="trends-tooltip-swatch" style="background:${point.color}"></span>
        ${escapeHtml(point.raceTitle)}
        <span class="trends-tooltip-call">${call}</span>
      </div>
      <div class="trends-tooltip-dense-meta">
        Search ${escapeHtml(formatVotePct(point.x))} · Result ${escapeHtml(formatVotePct(point.y))}
      </div>
    `;
    const preferRight = pctX < 55;
    tooltip.style.left = `${pctX}%`;
    tooltip.style.top = "28%";
    tooltip.style.transform = preferRight
      ? "translate(12px, -50%)"
      : "translate(calc(-100% - 12px), -50%)";
  };

  const hideTip = () => {
    tooltip.hidden = true;
    tooltip.classList.remove("is-dense");
    tooltip.innerHTML = "";
  };

  for (const dot of svg.querySelectorAll("[data-scatter-index]")) {
    const index = Number(dot.getAttribute("data-scatter-index"));
    dot.addEventListener("pointerenter", (event) => showTip(index, event.clientX));
    dot.addEventListener("pointermove", (event) => showTip(index, event.clientX));
    dot.addEventListener("pointerleave", hideTip);
    dot.addEventListener("focus", () => {
      const rect = svg.getBoundingClientRect();
      showTip(index, rect.left + rect.width / 2);
    });
    dot.addEventListener("blur", hideTip);
    dot.setAttribute("tabindex", "0");
    dot.setAttribute("role", "img");
    const point = points[index];
    if (point) {
      const call = point.predicted ? "hit" : "miss";
      dot.setAttribute(
        "aria-label",
        `${point.raceLabel}: search ${formatVotePct(point.x)}, result ${formatVotePct(point.y)}, ${call}`
      );
    }
  }
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

  const allRaces = trendsData?.races || [];
  const races = visibleRaces(allRaces);
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
      ${buildCorrelationPanel(races)}
    </div>
  `;

  bindInteractions(container, [activeRace]);
  wireScatterInteractions(container, races);
}

export function trendsFooterText() {
  if (!trendsData?.generated_at) return "";
  const count = visibleRaces(trendsData.races).length;
  return `Trends updated ${trendsData.generated_at} · ${count} race${count === 1 ? "" : "s"}`;
}
