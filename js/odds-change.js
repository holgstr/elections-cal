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

  const change = lookupOddsChange(slug, name, oddsFormat, matchName);
  const pctHtml = `<span class="primary-popover__pct">${formatPercent(pct)}</span>`;
  const changeHtml = renderOddsChangeBadge(change);

  return `<span class="primary-popover__odds-values">${pctHtml}${changeHtml}</span>`;
}
