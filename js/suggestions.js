const v = globalThis.__ECAL_V__ ?? "4";

const { flagUrl, flagAlt } = await import(`./flags.js?v=${v}`);
const { fetchJson } = await import(`./fetch-json.js?v=${v}`);
const { fetchSuggestionOdds, matchSuggestionPrice } = await import(`./primary-info.js?v=${v}`);
const { adjustChangeForLivePrice, roundExclusiveOdds } = await import(`./odds-change.js?v=${v}`);
const { formatDisplayName } = await import(`./display-name.js?v=${v}`);

const US_STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

const DE_STATE_NAMES = {
  BW: "Baden-Württemberg", BY: "Bavaria", BE: "Berlin", BB: "Brandenburg",
  HB: "Bremen", HH: "Hamburg", HE: "Hesse", MV: "Mecklenburg-Vorpommern",
  NI: "Lower Saxony", NW: "North Rhine-Westphalia", RP: "Rhineland-Palatinate",
  SL: "Saarland", SN: "Saxony", ST: "Saxony-Anhalt", SH: "Schleswig-Holstein",
  TH: "Thuringia",
};

const COUNTRY_NAMES = {
  US: "United States", DE: "Germany", BR: "Brazil", FR: "France", NG: "Nigeria",
  GB: "United Kingdom", IL: "Israel", LV: "Latvia", MX: "Mexico", NZ: "New Zealand",
  SE: "Sweden",
};

let suggestionsData = null;
let electionsByKey = new Map();

function electionLookupKey(election) {
  return [
    election.date,
    election.country_code,
    election.state_code || "",
    election.city_code || "",
  ].join("|");
}

function suggestionElectionKey(item) {
  return [
    item.election_date || "",
    item.country_code || "",
    item.state_code || "",
    item.city_code || "",
  ].join("|");
}

function electionStateCodes(election) {
  const codes = new Set();
  if (election.state_code) codes.add(election.state_code);
  for (const section of election.sections || []) {
    for (const state of section.states || []) {
      if (state.code) codes.add(state.code);
    }
  }
  return codes;
}

function findNestedState(election, stateCode) {
  if (!election || !stateCode) return null;
  if (election.state_code === stateCode) {
    return { name: election.state, code: election.state_code, offices: election.offices || [] };
  }
  for (const section of election.sections || []) {
    for (const state of section.states || []) {
      if (state.code === stateCode) return state;
    }
  }
  return null;
}

function findElectionForSuggestion(item) {
  const key = suggestionElectionKey(item);
  if (electionsByKey.has(key)) return electionsByKey.get(key);

  return [...electionsByKey.values()].find((election) => {
    if (item.country_code && election.country_code !== item.country_code) return false;
    if (item.state_code && !electionStateCodes(election).has(item.state_code)) return false;
    if (item.city_code && election.city_code !== item.city_code) return false;
    return true;
  }) || null;
}

function formatCardDate(isoDate, precision = "exact") {
  if (!isoDate) {
    return { day: "—", weekday: "", full: "", isEstimated: false };
  }
  const d = new Date(`${isoDate}T12:00:00`);
  const isEstimated = precision === "estimated";
  return {
    day: isEstimated ? "TBD" : d.getDate(),
    weekday: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
    full: d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    isEstimated,
  };
}

function pseudoElection(item, election) {
  const nestedState = item.state_code ? findNestedState(election, item.state_code) : null;
  const country = election?.country || COUNTRY_NAMES[item.country_code] || item.country_code;
  const state = election?.state || nestedState?.name
    || (item.country_code === "US" ? US_STATE_NAMES[item.state_code] : null)
    || (item.country_code === "DE" ? DE_STATE_NAMES[item.state_code] : null);
  const city = election?.city || null;

  return {
    country,
    country_code: item.country_code,
    state,
    state_code: item.state_code,
    city,
    city_code: item.city_code,
    date: item.election_date || election?.date || null,
    date_precision: election?.date_precision || "exact",
    title: election?.title || item.contest,
  };
}

function cardTitle(item, election) {
  if (election?.state) return election.state;
  if (election?.city) return election.city;
  if (item.state_code) {
    if (item.country_code === "US") return US_STATE_NAMES[item.state_code] || item.state_code;
    if (item.country_code === "DE") return DE_STATE_NAMES[item.state_code] || item.state_code;
  }
  return election?.country || COUNTRY_NAMES[item.country_code] || item.country_code || "Election";
}

function contestLabel(item) {
  if (item.market_label && item.market_label !== item.contest) {
    return `${item.contest} · ${item.market_label}`;
  }
  return item.contest;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function polymarketEventUrl(slug) {
  if (!slug) return null;
  return `https://polymarket.com/event/${encodeURIComponent(slug)}`;
}

function renderContestLabelTag(item) {
  const label = contestLabel(item);
  const safeLabel = escapeHtml(label);
  const url = polymarketEventUrl(item.slug);

  if (!url) {
    return `<span class="office-tag">${safeLabel}</span>`;
  }

  return `<a class="office-tag office-tag--external" href="${url}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
}

function isTouchPrimary() {
  return window.matchMedia("(hover: none), (pointer: coarse)").matches;
}

let suggestionLinksBound = false;

function bindSuggestionLinks(container) {
  if (!container || suggestionLinksBound) return;
  suggestionLinksBound = true;

  container.addEventListener("click", (event) => {
    const link = event.target.closest("a.office-tag--external");
    if (!link?.href || !isTouchPrimary()) return;

    event.preventDefault();
    window.open(link.href, "_blank", "noopener,noreferrer");
  });
}

function renderChangeArrow(change) {
  if (!change?.change_pp) return `<span class="price-change price-change--placeholder" aria-hidden="true">--</span>`;
  const arrow = change.direction === "up" ? "↑" : "↓";
  const cls = change.direction === "up" ? "price-change--up" : "price-change--down";
  return `<span class="price-change ${cls}" aria-label="${change.direction === "up" ? "Up" : "Down"} ${Math.round(change.change_pp)} percentage points">${arrow} ${Math.round(change.change_pp)}%</span>`;
}

function renderPriceRow(price) {
  const change = price.change_pp ? price : null;
  const shownPct = price.display_pct ?? Math.round(price.current_pct);
  const pct = `<span class="price-current">${shownPct}%</span>`;
  const changeHtml = change ? renderChangeArrow(change) : `<span class="price-change price-change--placeholder" aria-hidden="true">--</span>`;
  return `<li class="price-row${change ? " price-row--changed" : ""}"><span class="price-name">${escapeHtml(formatDisplayName(price.name))}</span>${pct}${changeHtml}</li>`;
}

function withDisplayPercents(prices) {
  const displayPcts = roundExclusiveOdds(prices.map((price) => price.current_pct));
  return prices.map((price, index) => ({
    ...price,
    display_pct: displayPcts[index],
  }));
}

function mergeLivePrices(item, liveCandidates) {
  const oddsFormat = item.odds_format || "candidates";
  const thresholdPp = suggestionsData?.threshold_pp ?? 4;

  return liveCandidates.map((candidate) => {
    const matched = matchSuggestionPrice(item.prices, candidate.name, oddsFormat);
    const merged = {
      name: candidate.name,
      current_pct: candidate.pct,
    };

    if (!matched?.change_pp && matched?.reference_pct == null) {
      return merged;
    }

    const adjusted = adjustChangeForLivePrice(
      matched,
      matched?.current_pct,
      candidate.pct,
      thresholdPp
    );

    if (adjusted?.change_pp) {
      merged.change_pp = adjusted.change_pp;
      merged.direction = adjusted.direction;
      merged.change_days = matched.change_days ?? item.window_days ?? 2;
      merged.since_date = matched.since_date ?? adjusted.reference_date;
    }

    return merged;
  });
}

async function refreshSuggestionPrices(container, items) {
  const cards = [...container.querySelectorAll(".card-suggestion")];
  const cardByMarketId = new Map(
    cards
      .map((card) => [card.dataset.marketId, card])
      .filter(([marketId]) => marketId)
  );

  await Promise.all(
    items.map(async (item) => {
      const card = cardByMarketId.get(item.market_id);
      if (!card) return;

      try {
        const liveCandidates = await fetchSuggestionOdds(item);
        if (!liveCandidates.length) return;

        const prices = withDisplayPercents(mergeLivePrices(item, liveCandidates));
        const priceList = card.querySelector(".price-list");
        if (!priceList) return;

        priceList.innerHTML = prices.map(renderPriceRow).join("");
      } catch {
        // Keep the snapshot prices when live refresh fails.
      }
    })
  );
}

function renderSuggestionCard(item) {
  const election = findElectionForSuggestion(item);
  const pseudo = pseudoElection(item, election);
  const { day, weekday, full, isEstimated } = formatCardDate(
    pseudo.date,
    pseudo.date_precision
  );
  const title = cardTitle(item, election);

  return `
    <article class="card card-suggestion" data-market-id="${escapeHtml(item.market_id)}">
      <img class="card-flag" src="${flagUrl(pseudo)}" alt="${flagAlt(pseudo)}" width="30" height="20" loading="lazy" />
      <div class="card-date">
        <div class="card-day${isEstimated ? " card-day-tbd" : ""}">${day}</div>
        <div class="card-weekday">${weekday}</div>
      </div>
      <div class="card-body">
        <div class="card-topline">
          <h3 class="card-title">${title}</h3>
        </div>
        <div class="card-labels">${renderContestLabelTag(item)}</div>
        <ul class="price-list" aria-label="Market probabilities">
          ${withDisplayPercents(item.prices).map(renderPriceRow).join("")}
        </ul>
      </div>
      ${pseudo.date ? `<time class="card-time" datetime="${pseudo.date}">${full}</time>` : ""}
    </article>
  `;
}

const STATE_MARKET_CATEGORIES = new Set([
  "us_primary",
  "us_governor",
  "us_senate",
  "de_state",
]);

function isStateSuggestion(item, election) {
  if (election) {
    if (election.level === "state") return true;
    if (
      election.sections?.length &&
      !election.sections.some((section) => section.level === "federal")
    ) {
      return true;
    }
    return false;
  }

  return Boolean(
    item.state_code || STATE_MARKET_CATEGORIES.has(item.category)
  );
}

function isLocalSuggestion(item, election) {
  if (election) return election.level === "local";
  return Boolean(item.city_code || item.category === "mayoral");
}

export function filterSuggestions(items, { hideStates = false, hideLocal = false } = {}) {
  if (!hideStates && !hideLocal) return items;

  return items.filter((item) => {
    const election = findElectionForSuggestion(item);
    if (hideStates && isStateSuggestion(item, election)) return false;
    if (hideLocal && isLocalSuggestion(item, election)) return false;
    return true;
  });
}

function maxChangePp(item) {
  if (item.max_change_pp != null) return item.max_change_pp;
  const changes = item.changes || item.prices?.filter((price) => price.change_pp) || [];
  return Math.max(0, ...changes.map((change) => change.change_pp || 0));
}

function sortByMaxChange(items) {
  return [...items].sort((a, b) => maxChangePp(b) - maxChangePp(a));
}

export async function loadSuggestionsData(fetcher = fetchJson) {
  const [suggestions, elections] = await Promise.all([
    fetcher("data/market_suggestions.json"),
    fetcher("data/elections.json"),
  ]);

  suggestionsData = suggestions;
  electionsByKey = new Map();
  for (const election of elections) {
    electionsByKey.set(electionLookupKey(election), election);
  }

  return suggestions;
}

export async function renderSuggestions(
  container,
  { hideStates = false, hideLocal = false } = {}
) {
  if (!container) return;

  const allItems = suggestionsData?.suggestions || [];
  const items = filterSuggestions(allItems, { hideStates, hideLocal });
  if (!items.length) {
    const updated = suggestionsData?.generated_at
      ? `Last checked ${suggestionsData.generated_at}. `
      : "";
    if (allItems.length && (hideStates || hideLocal)) {
      container.innerHTML = `<p class="empty">${updated}No races match your filters.</p>`;
      return;
    }
    container.innerHTML = `<p class="empty">${updated}No races with ≥${suggestionsData?.threshold_pp ?? 4}pp market moves in the last 48 hours right now.</p>`;
    return;
  }

  const sorted = sortByMaxChange(items);
  container.innerHTML = `<div class="cards">${sorted.map(renderSuggestionCard).join("")}</div>`;

  bindSuggestionLinks(container);
  await refreshSuggestionPrices(container, items);
}

export function suggestionsFooterText(
  { hideStates = false, hideLocal = false } = {}
) {
  if (!suggestionsData?.generated_at) return "";
  const count = filterSuggestions(suggestionsData.suggestions || [], {
    hideStates,
    hideLocal,
  }).length;
  return `Market prices updated ${suggestionsData.generated_at} · ${count} race${count === 1 ? "" : "s"} with ≥${suggestionsData.threshold_pp ?? 4}pp moves (48h)`;
}
