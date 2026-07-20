const PARTY_CHANGE_ALIASES = {
  Democratic: "Democrat",
};

let oddsChangesBySlug = {};

export async function loadOddsChanges(fetchJson) {
  try {
    const data = await fetchJson("data/market_odds_changes.json");
    oddsChangesBySlug = data.by_slug || {};
  } catch {
    oddsChangesBySlug = {};
  }
}

export function lookupOddsChange(slug, displayName, oddsFormat = "candidates", matchName = null) {
  if (!slug || displayName == null) return null;

  const outcomes = oddsChangesBySlug[slug];
  if (!outcomes) return null;

  const alias = PARTY_CHANGE_ALIASES[displayName];
  if (alias && outcomes[alias]) return outcomes[alias];
  if (outcomes[displayName]) return outcomes[displayName];

  if (oddsFormat === "candidates" && matchName) {
    for (const [name, change] of Object.entries(outcomes)) {
      if (matchName(name) === displayName) return change;
    }
  }

  return null;
}

export function deriveReferencePct(change, snapshotCurrentPct = null) {
  if (!change) return null;
  if (change.reference_pct != null) return change.reference_pct;
  if (change.change_pp == null) return null;

  const snapshotPct = snapshotCurrentPct ?? change.current_pct;
  if (snapshotPct == null) return null;

  return change.direction === "up"
    ? snapshotPct - change.change_pp
    : snapshotPct + change.change_pp;
}

export function computeChangeFromReference(referencePct, currentPct, thresholdPp = 0) {
  if (referencePct == null || currentPct == null) return null;

  const delta = Math.round((currentPct - referencePct) * 100) / 100;
  if (Math.abs(delta) < thresholdPp) return null;

  return {
    change_pp: Math.abs(delta),
    direction: delta > 0 ? "up" : "down",
    reference_pct: referencePct,
    reference_date: null,
    window: null,
  };
}

export function adjustChangeForLivePrice(
  staticChange,
  snapshotCurrentPct,
  livePct,
  thresholdPp = 0
) {
  const referencePct = deriveReferencePct(staticChange, snapshotCurrentPct);
  if (referencePct == null) return staticChange;

  const adjusted = computeChangeFromReference(referencePct, livePct, thresholdPp);
  if (!adjusted) return null;

  return {
    ...staticChange,
    ...adjusted,
  };
}

export function renderOddsChangeBadge(change) {
  if (!change?.change_pp) {
    return `<span class="price-change price-change--placeholder" aria-hidden="true">--</span>`;
  }

  const arrow = change.direction === "up" ? "↑" : "↓";
  const cls = change.direction === "up" ? "price-change--up" : "price-change--down";
  const directionLabel = change.direction === "up" ? "Up" : "Down";

  return `<span class="price-change ${cls}" aria-label="${directionLabel} ${Math.round(change.change_pp)} percentage points">${arrow} ${Math.round(change.change_pp)}%</span>`;
}

/** Above this, prices are treated as multi-advance (may legitimately sum well over 100). */
export const MAX_EXCLUSIVE_ODDS_SUM = 125;

/**
 * Round mutually exclusive outcome percentages so displayed integers never sum
 * above 100. Multi-advance markets (sum > MAX_EXCLUSIVE_ODDS_SUM) round independently.
 */
export function roundExclusiveOdds(pcts) {
  const values = (pcts || []).map((pct) => {
    const n = Number(pct);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  });
  if (!values.length) return [];

  const total = values.reduce((sum, pct) => sum + pct, 0);
  if (total <= 0) return values.map(() => 0);

  // Top-two / top-four "who advances" markets: leave independent rounding.
  if (total > MAX_EXCLUSIVE_ODDS_SUM) {
    return values.map((pct) => Math.round(pct));
  }

  const target = total > 100 ? 100 : Math.round(total);
  const scaled = total > 100 ? values.map((pct) => (pct / total) * 100) : values;
  const floors = scaled.map((pct) => Math.floor(pct));
  let remaining = target - floors.reduce((sum, pct) => sum + pct, 0);

  const byFraction = scaled
    .map((pct, index) => ({ index, fraction: pct - Math.floor(pct) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const rounded = [...floors];
  for (const { index } of byFraction) {
    if (remaining <= 0) break;
    rounded[index] += 1;
    remaining -= 1;
  }

  return rounded;
}

export function formatOddsPctWithChange(
  pct,
  slug,
  name,
  oddsFormat,
  formatPercent,
  matchName,
  displayPct = null
) {
  if (pct == null && displayPct == null) return "";

  const staticChange = lookupOddsChange(slug, name, oddsFormat, matchName);
  const change = adjustChangeForLivePrice(staticChange, null, pct, 0);
  const shown = displayPct ?? pct;
  const pctHtml = `<span class="primary-popover__pct">${formatPercent(shown)}</span>`;
  const changeHtml = renderOddsChangeBadge(change);

  return `<span class="primary-popover__odds-values">${pctHtml}${changeHtml}</span>`;
}
