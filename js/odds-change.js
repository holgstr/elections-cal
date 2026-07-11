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

export function formatOddsPctWithChange(pct, slug, name, oddsFormat, formatPercent, matchName) {
  if (pct == null) return "";

  const staticChange = lookupOddsChange(slug, name, oddsFormat, matchName);
  const change = adjustChangeForLivePrice(staticChange, null, pct, 0);
  const pctHtml = `<span class="primary-popover__pct">${formatPercent(pct)}</span>`;
  const changeHtml = renderOddsChangeBadge(change);

  return `<span class="primary-popover__odds-values">${pctHtml}${changeHtml}</span>`;
}
