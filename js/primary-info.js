const POLYMARKET_API = "https://gamma-api.polymarket.com/events";
const MIN_POLYMARKET_PCT = 3;
const MIN_DE_STATE_POLYMARKET_PCT = 10;
const MIN_NATIONAL_PARTY_POLYMARKET_PCT = 10;
const GOVERNOR_PARTY_ORDER = ["Republican", "Democrat"];
const GOVERNOR_PARTY_LABELS = {
  Republican: "Republican",
  Democrat: "Democratic",
};

const v = globalThis.__ECAL_V__ ?? "4";
const { formatOddsPctWithChange, loadOddsChanges } = await import(`./odds-change.js?v=${v}`);

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

const PRIMARY_TYPE_LABELS = {
  open: "Open primary",
  "semi-closed": "Semi-closed primary",
  closed: "Closed primary",
  "top-two": "Top-two primary",
  party: "Party primaries",
};

const COMBINED_BALLOT_FORMATS = new Set(["top-two", "top-four"]);

const PRESIDENTIAL_LABEL_RE = /^President(?:\s+—\s+Round\s+\d+)?$/i;

let primaryInfo = {};
let primaryWindowMonths = 3;
let presidentialInfo = {};
let presidentialWindowMonths = 12;
let deStateInfo = {};
let deStateWindowMonths = 12;
let usGovernorInfo = {};
let usGovernorWindowMonths = 12;
let usSenateInfo = {};
let usSenateWindowMonths = 12;
let mayoralInfo = {};
let mayoralWindowMonths = 12;
let nationalElectionInfo = {};
let nationalElectionWindowMonths = 12;
const oddsCache = new Map();

let popoverEl = null;
let activeTrigger = null;
let hoverCloseTimer = null;

export async function loadPrimaryInfo(fetchJson) {
  oddsCache.clear();

  try {
    const data = await fetchJson("data/curated/us_primary_info.json");
    if (data._window_months) {
      primaryWindowMonths = data._window_months;
    }
    delete data._comment;
    delete data._window_months;
    primaryInfo = data;
  } catch {
    primaryInfo = {};
  }

  try {
    const data = await fetchJson("data/curated/presidential_info.json");
    if (data._window_months) {
      presidentialWindowMonths = data._window_months;
    }
    delete data._comment;
    delete data._window_months;
    presidentialInfo = data;
  } catch {
    presidentialInfo = {};
  }

  try {
    const data = await fetchJson("data/curated/de_state_info.json");
    if (data._window_months) {
      deStateWindowMonths = data._window_months;
    }
    delete data._comment;
    delete data._window_months;
    deStateInfo = data;
  } catch {
    deStateInfo = {};
  }

  try {
    const data = await fetchJson("data/curated/us_governor_info.json");
    if (data._window_months) {
      usGovernorWindowMonths = data._window_months;
    }
    delete data._comment;
    delete data._window_months;
    usGovernorInfo = data;
  } catch {
    usGovernorInfo = {};
  }

  try {
    const data = await fetchJson("data/curated/us_senate_info.json");
    if (data._window_months) {
      usSenateWindowMonths = data._window_months;
    }
    delete data._comment;
    delete data._window_months;
    usSenateInfo = data;
  } catch {
    usSenateInfo = {};
  }

  try {
    const data = await fetchJson("data/curated/mayoral_info.json");
    if (data._window_months) {
      mayoralWindowMonths = data._window_months;
    }
    delete data._comment;
    delete data._window_months;
    mayoralInfo = data;
  } catch {
    mayoralInfo = {};
  }

  try {
    const data = await fetchJson("data/curated/national_election_info.json");
    if (data._window_months) {
      nationalElectionWindowMonths = data._window_months;
    }
    delete data._comment;
    delete data._window_months;
    nationalElectionInfo = data;
  } catch {
    nationalElectionInfo = {};
  }

  await loadOddsChanges(fetchJson);
}

function isWithinWindow(electionDate, windowMonths) {
  if (!electionDate) return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setMonth(end.getMonth() + windowMonths);

  const date = new Date(`${electionDate}T12:00:00`);
  return date >= today && date <= end;
}

function isWithinPrimaryWindow(electionDate) {
  return isWithinWindow(electionDate, primaryWindowMonths);
}

function isWithinPresidentialWindow(electionDate) {
  return isWithinWindow(electionDate, presidentialWindowMonths);
}

export function getPrimaryInfo(stateCode, office, electionDate) {
  if (!stateCode || !office) return null;
  if (!isWithinPrimaryWindow(electionDate)) return null;
  return primaryInfo[stateCode]?.[office] ?? null;
}

export function isPresidentialLabel(label) {
  return PRESIDENTIAL_LABEL_RE.test(label?.trim() || "");
}

export function getPresidentialInfo(countryCode, electionDate) {
  if (!countryCode) return null;
  if (!isWithinPresidentialWindow(electionDate)) return null;
  return presidentialInfo[countryCode] ?? null;
}

function isWithinDeStateWindow(electionDate) {
  return isWithinWindow(electionDate, deStateWindowMonths);
}

function isWithinGovernorWindow(electionDate) {
  return isWithinWindow(electionDate, usGovernorWindowMonths);
}

export function isGovernorLabel(label) {
  return label?.trim() === "Governor";
}

export function isSenateLabel(label) {
  return label?.trim() === "Senate";
}

export function getDeStateInfo(stateCode, label, electionDate) {
  if (!stateCode || !label) return null;
  if (!isWithinDeStateWindow(electionDate)) return null;

  const info = deStateInfo[stateCode];
  if (!info || info.label !== label) return null;
  return info;
}

export function getGovernorInfo(stateCode, electionDate) {
  if (!stateCode) return null;
  if (!isWithinGovernorWindow(electionDate)) return null;
  return usGovernorInfo[stateCode] ?? null;
}

function isWithinSenateWindow(electionDate) {
  return isWithinWindow(electionDate, usSenateWindowMonths);
}

export function getSenateInfo(stateCode, electionDate) {
  if (!stateCode) return null;
  if (!isWithinSenateWindow(electionDate)) return null;
  return usSenateInfo[stateCode] ?? null;
}

function isWithinMayoralWindow(electionDate) {
  return isWithinWindow(electionDate, mayoralWindowMonths);
}

export function isMayorLabel(label) {
  return label?.trim() === "Mayor";
}

export function getMayoralInfo(cityCode, electionDate, countryCode = null) {
  if (!cityCode && !countryCode) return null;
  if (!isWithinMayoralWindow(electionDate)) return null;

  if (cityCode && mayoralInfo[cityCode]) return mayoralInfo[cityCode];
  if (countryCode && mayoralInfo[countryCode]) return mayoralInfo[countryCode];
  return null;
}

function isWithinNationalElectionWindow(electionDate) {
  return isWithinWindow(electionDate, nationalElectionWindowMonths);
}

export function resolveNationalElectionLabel(
  countryCode,
  label,
  electionDate,
  alternateLabels = []
) {
  if (!countryCode) return null;
  if (!isWithinNationalElectionWindow(electionDate)) return null;

  const contests = nationalElectionInfo[countryCode];
  if (!contests) return null;

  const seen = new Set();
  for (const key of [label, ...alternateLabels]) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (contests[key]) return key;
  }

  return null;
}

export function getNationalElectionInfo(
  countryCode,
  label,
  electionDate,
  alternateLabels = []
) {
  const matchedLabel = resolveNationalElectionLabel(
    countryCode,
    label,
    electionDate,
    alternateLabels
  );
  if (!matchedLabel) return null;
  return nationalElectionInfo[countryCode][matchedLabel];
}

export function labelToOffice(label) {
  const match = label.match(/^(?:(?:Democratic|Republican)\s+)?(Governor|Senate)\s+Primary(?:\s+Runoff)?$/i);
  return match ? match[1] : null;
}

export function hasPrimaryInfo(stateCode, label, electionDate) {
  const office = labelToOffice(label);
  return Boolean(getPrimaryInfo(stateCode, office, electionDate));
}

function primaryKey(stateCode, office) {
  return `${stateCode}:${office}`;
}

function parsePrimaryKey(key) {
  const [stateCode, office] = key.split(":");
  return { stateCode, office };
}

function stripPartySuffix(name) {
  return name.replace(/\s*\([A-Z](?:-[A-Z]{2})?\)\s*$/i, "").trim();
}

function surname(name) {
  const cleaned = stripPartySuffix(name.trim());
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return cleaned || name.trim();

  const last = parts[parts.length - 1].replace(/\./g, "").toLowerCase();
  if (NAME_SUFFIXES.has(last) && parts.length > 1) {
    return parts[parts.length - 2];
  }

  return parts[parts.length - 1];
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
}

function formatOddsPct(pct, slug = null, name = null, oddsFormat = "candidates") {
  if (pct == null) return "";
  if (!slug || name == null) {
    return `<span class="primary-popover__pct">${formatPercent(pct)}</span>`;
  }
  return formatOddsPctWithChange(pct, slug, name, oddsFormat, formatPercent, surname);
}

function partySlug(party) {
  if (party === "Republican") return "republican";
  if (party === "Democratic") return "democratic";
  return party.toLowerCase().replace(/\s+/g, "-");
}

function parseOutcomePrice(outcomePrices) {
  if (!outcomePrices) return null;
  try {
    const prices = typeof outcomePrices === "string" ? JSON.parse(outcomePrices) : outcomePrices;
    return parseFloat(prices[0]) * 100;
  } catch {
    return null;
  }
}

function isIncumbent(candidateName, incumbentSurname) {
  if (!incumbentSurname) return false;
  return candidateName.toLowerCase() === incumbentSurname.toLowerCase();
}

function formatCandidateName(candidate) {
  return candidate.incumbent ? `${candidate.name} (Inc.)` : candidate.name;
}

function isPlaceholderMarketName(name) {
  return (
    !name ||
    name === "Other" ||
    /^Candidate [A-Z]+$/i.test(name) ||
    /^Option [A-Z]+$/i.test(name) ||
    /^Person [A-Z]+$/i.test(name)
  );
}

function isActivePolymarketMarket(market) {
  return market?.active !== false;
}

function isIncludedPolymarketMarket(market) {
  const name = market?.groupItemTitle;
  return isActivePolymarketMarket(market) && !isPlaceholderMarketName(name);
}

async function fetchPolymarketOdds(slug, incumbentSurname = null) {
  const cacheKey = incumbentSurname ? `${slug}:${incumbentSurname}` : slug;
  if (oddsCache.has(cacheKey)) return oddsCache.get(cacheKey);

  const promise = (async () => {
    const res = await fetch(`${POLYMARKET_API}?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error("Polymarket fetch failed");
    const data = await res.json();
    const markets = data[0]?.markets || [];

    const candidates = markets
      .map((market) => {
        if (!isIncludedPolymarketMarket(market)) return null;
        const name = market.groupItemTitle;
        const pct = parseOutcomePrice(market.outcomePrices);
        if (pct == null) return null;
        const candidateName = surname(name);
        return {
          name: candidateName,
          pct,
          incumbent: isIncumbent(candidateName, incumbentSurname),
        };
      })
      .filter(Boolean)
      .filter((c) => c.pct > MIN_POLYMARKET_PCT)
      .sort((a, b) => b.pct - a.pct);

    return { candidates, hasMarket: true };
  })();

  oddsCache.set(cacheKey, promise);
  return promise;
}

async function fetchNomineeSurname(slug, incumbentSurname = null) {
  const cacheKey = `nominee:${slug}:${incumbentSurname || ""}`;
  if (oddsCache.has(cacheKey)) return oddsCache.get(cacheKey);

  const promise = (async () => {
    const res = await fetch(`${POLYMARKET_API}?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error("Polymarket fetch failed");
    const data = await res.json();
    const markets = data[0]?.markets || [];

    const candidates = markets
      .map((market) => {
        if (!isIncludedPolymarketMarket(market)) return null;
        const name = market.groupItemTitle;
        const pct = parseOutcomePrice(market.outcomePrices);
        if (pct == null) return null;
        const candidateName = surname(name);
        return {
          name: candidateName,
          pct,
          incumbent: isIncumbent(candidateName, incumbentSurname),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.pct - a.pct);

    return candidates[0] ?? null;
  })();

  oddsCache.set(cacheKey, promise);
  return promise;
}

async function fetchPolymarketPartyOdds(slug, minPct) {
  const cacheKey = `party:${slug}:${minPct}`;
  if (oddsCache.has(cacheKey)) return oddsCache.get(cacheKey);

  const promise = (async () => {
    const res = await fetch(`${POLYMARKET_API}?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error("Polymarket fetch failed");
    const data = await res.json();
    const markets = data[0]?.markets || [];

    const candidates = markets
      .map((market) => {
        if (!isIncludedPolymarketMarket(market)) return null;
        const name = market.groupItemTitle;
        const pct = parseOutcomePrice(market.outcomePrices);
        if (pct == null) return null;
        return { name, pct };
      })
      .filter(Boolean)
      .filter((c) => c.pct > minPct)
      .sort((a, b) => b.pct - a.pct);

    return { candidates, hasMarket: true };
  })();

  oddsCache.set(cacheKey, promise);
  return promise;
}

async function fetchPolymarketBinaryOdds(slug, minPct) {
  const cacheKey = `binary:${slug}:${minPct}`;
  if (oddsCache.has(cacheKey)) return oddsCache.get(cacheKey);

  const promise = (async () => {
    const res = await fetch(`${POLYMARKET_API}?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error("Polymarket fetch failed");
    const data = await res.json();
    const market = (data[0]?.markets || []).find(isActivePolymarketMarket);
    if (!market) return { candidates: [], hasMarket: false };

    let outcomes = market.outcomes;
    let prices = market.outcomePrices;
    try {
      outcomes = typeof outcomes === "string" ? JSON.parse(outcomes) : outcomes;
      prices = typeof prices === "string" ? JSON.parse(prices) : prices;
    } catch {
      return { candidates: [], hasMarket: true };
    }

    const candidates = (outcomes || [])
      .map((name, index) => {
        const pct = parseFloat(prices?.[index]) * 100;
        if (Number.isNaN(pct)) return null;
        return { name, pct };
      })
      .filter(Boolean)
      .filter((candidate) => candidate.pct > minPct)
      .sort((a, b) => b.pct - a.pct);

    return { candidates, hasMarket: true };
  })();

  oddsCache.set(cacheKey, promise);
  return promise;
}

async function fetchGovernorOdds(slug) {
  const cacheKey = `governor:${slug}`;
  if (oddsCache.has(cacheKey)) return oddsCache.get(cacheKey);

  const promise = (async () => {
    const res = await fetch(`${POLYMARKET_API}?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error("Polymarket fetch failed");
    const data = await res.json();
    const markets = data[0]?.markets || [];
    const parties = {};

    for (const market of markets) {
      if (!isActivePolymarketMarket(market)) continue;
      const party = market.groupItemTitle;
      const pct = parseOutcomePrice(market.outcomePrices);
      if (!GOVERNOR_PARTY_ORDER.includes(party) || pct == null) continue;
      parties[party] = pct;
    }

    return { parties, hasMarket: true };
  })();

  oddsCache.set(cacheKey, promise);
  return promise;
}

async function loadPartySection(config) {
  if (config.polymarket_slug) {
    try {
      return await fetchPolymarketOdds(config.polymarket_slug, config.incumbent);
    } catch {
      return { candidates: [], error: true, hasMarket: true };
    }
  }

  if (config.incumbent) {
    return {
      candidates: [{ name: config.incumbent, incumbent: true }],
      hasMarket: false,
    };
  }

  return { candidates: [], hasMarket: false };
}

function renderCandidateRows(section, { slug = null, oddsFormat = "candidates" } = {}) {
  if (section.error) {
    return `<p class="primary-popover__empty">Could not load market data</p>`;
  }

  if (!section.candidates.length) {
    return "";
  }

  return `<ul class="primary-popover__candidates">${section.candidates
    .map((candidate) => {
      const pct = formatOddsPct(candidate.pct, slug, candidate.name, oddsFormat);
      return `<li><span class="primary-popover__name">${formatCandidateName(candidate)}</span>${pct}</li>`;
    })
    .join("")}</ul>`;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function polymarketEventUrl(slug) {
  if (!slug) return null;
  return `https://polymarket.com/event/${encodeURIComponent(slug)}`;
}

function renderLinkedText(label, slug, { className = "", linkClassName = "primary-popover__link" } = {}) {
  const safeLabel = escapeHtml(label);
  const url = polymarketEventUrl(slug);
  if (!url) {
    return className ? `<span class="${className}">${safeLabel}</span>` : safeLabel;
  }

  const classes = [linkClassName, className].filter(Boolean).join(" ");
  return `<a class="${classes}" href="${url}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
}

function renderSectionHeadline(label, infoIcon = "", slug = null) {
  const labelHtml = renderLinkedText(label, slug, { className: "primary-popover__type-label" });
  return `
    <p class="primary-popover__type">
      ${labelHtml}${infoIcon}
    </p>`;
}

function renderPartyName(party, slug) {
  const partyClass = `primary-popover__party-name primary-popover__party-name--${partySlug(party)}`;
  return renderLinkedText(party, slug, {
    className: partyClass,
    linkClassName: `${partyClass} primary-popover__link`,
  });
}

function renderTypeHeader(info, slug = null) {
  const typeLabel =
    info.primary_type_label ||
    PRIMARY_TYPE_LABELS[info.primary_type] ||
    info.primary_type;

  const formatNote = info.primary_type_note || "";
  const infoIcon = formatNote
    ? `<span class="primary-popover__info" tabindex="0" aria-label="${escapeHtml(formatNote)}">
        <span class="primary-popover__info-icon" aria-hidden="true">i</span>
        <span class="primary-popover__info-tip" role="tooltip">${escapeHtml(formatNote)}</span>
      </span>`
    : "";

  return renderSectionHeadline(typeLabel, infoIcon, slug);
}

function renderPopoverBody(info, partySections) {
  const partyConfigs = info.parties || {};
  const partyBlocks = Object.entries(partySections)
    .filter(([, section]) => section.candidates.length || section.error)
    .map(([party, section]) => {
      const candidateRows = renderCandidateRows(section, {
        slug: partyConfigs[party]?.polymarket_slug,
        oddsFormat: "candidates",
      });
      if (!candidateRows && !section.error) return "";
      const slug = partyConfigs[party]?.polymarket_slug;

      return `
        <div class="primary-popover__party">
          <div class="primary-popover__party-head">
            ${renderPartyName(party, slug)}
          </div>
          ${candidateRows}
        </div>`;
    })
    .filter(Boolean)
    .join("");

  return `
    ${renderTypeHeader(info)}
    <div class="primary-popover__parties">${partyBlocks}</div>`;
}

function isCombinedBallotPrimary(info) {
  return COMBINED_BALLOT_FORMATS.has(info.primary_format);
}

function renderCombinedBallotBody(info, section) {
  const candidates = renderCandidateRows(section, {
    slug: info.polymarket_slug,
    oddsFormat: "candidates",
  });

  return `
    ${renderTypeHeader(info, info.polymarket_slug)}
    ${candidates}`;
}

function renderPresidentialBody(info, section) {
  const label = info.label || "Presidential election";
  const candidates = renderCandidateRows(section, {
    slug: info.polymarket_slug,
    oddsFormat: "candidates",
  });

  return `
    ${renderSectionHeadline(label, "", info.polymarket_slug)}
    ${candidates}`;
}

function normalizeElectionMarkets(info) {
  if (Array.isArray(info.markets) && info.markets.length) {
    return info.markets;
  }

  if (info.polymarket_slug) {
    return [
      {
        polymarket_slug: info.polymarket_slug,
        label: info.label,
        odds_format: info.odds_format || "party",
      },
    ];
  }

  return [];
}

async function loadElectionMarketSection(market, partyMinPct) {
  if (!market.polymarket_slug) {
    return { candidates: [], hasMarket: false };
  }

  try {
    if (market.odds_format === "party") {
      return await fetchPolymarketPartyOdds(market.polymarket_slug, partyMinPct);
    }
    if (market.odds_format === "binary") {
      return await fetchPolymarketBinaryOdds(market.polymarket_slug, partyMinPct);
    }
    return await fetchPolymarketOdds(market.polymarket_slug);
  } catch {
    return { candidates: [], error: true, hasMarket: true };
  }
}

function renderElectionMarketBlock(market, section) {
  const label = market.label || "Election";
  const oddsFormat = market.odds_format || "party";
  const candidates = renderCandidateRows(section, {
    slug: market.polymarket_slug,
    oddsFormat,
  });
  if (!candidates && !section.error) return "";

  return `
    <div class="primary-popover__party">
      ${renderSectionHeadline(label, "", market.polymarket_slug)}
      ${candidates || `<p class="primary-popover__empty">Could not load market data</p>`}
    </div>`;
}

function renderStackedElectionBody(contestLabel, marketSections) {
  const blocks = marketSections
    .map(({ market, section }) => renderElectionMarketBlock(market, section))
    .filter(Boolean)
    .join("");

  if (!blocks) {
    return `<p class="primary-popover__empty">No market data available</p>`;
  }

  const singleMarket = marketSections.length === 1 ? marketSections[0] : null;
  if (singleMarket) {
    const { market, section } = singleMarket;
    const marketLabel = (market.label || "").trim();
    const showNested =
      marketSections.length > 1 ||
      (marketLabel && marketLabel.toLowerCase() !== contestLabel.trim().toLowerCase());

    if (!showNested) {
      const oddsFormat = market.odds_format || "party";
      const candidates = renderCandidateRows(section, {
        slug: market.polymarket_slug,
        oddsFormat,
      });
      return `
        ${renderSectionHeadline(contestLabel, "", market.polymarket_slug)}
        ${candidates || `<p class="primary-popover__empty">Could not load market data</p>`}`;
    }
  }

  return `${renderSectionHeadline(contestLabel)}<div class="primary-popover__parties">${blocks}</div>`;
}

function renderGovernorPartyRows(section, nominees = {}, slug = null) {
  if (section.error) {
    return `<p class="primary-popover__empty">Could not load market data</p>`;
  }

  const parties = GOVERNOR_PARTY_ORDER.filter((party) => section.parties?.[party] != null);
  if (!parties.length) {
    return "";
  }

  const partyBlocks = parties
    .map((party) => {
      const partyLabel = GOVERNOR_PARTY_LABELS[party] || party;
      const nominee = nominees[party];
      const candidateName = nominee ? formatCandidateName(nominee) : "TBD";

      return `
        <div class="primary-popover__party">
          <div class="primary-popover__party-head">
            <span class="primary-popover__party-name primary-popover__party-name--${partySlug(partyLabel)}">${escapeHtml(partyLabel)}</span>
          </div>
          <ul class="primary-popover__candidates">
            <li>
              <span class="primary-popover__name">${candidateName}</span>
              ${formatOddsPct(section.parties[party], slug, partyLabel, "party")}
            </li>
          </ul>
        </div>`;
    })
    .join("");

  return `<div class="primary-popover__parties">${partyBlocks}</div>`;
}

function renderGovernorBody(section, nominees = {}, slug = null) {
  return `
    ${renderSectionHeadline("Governor", "", slug)}
    ${renderGovernorPartyRows(section, nominees, slug)}`;
}

function renderSenateBody(section, nominees = {}, slug = null) {
  return `
    ${renderSectionHeadline("Senate", "", slug)}
    ${renderGovernorPartyRows(section, nominees, slug)}`;
}

function renderGovernorCandidateBody(section, slug = null) {
  const candidates = renderCandidateRows(section, {
    slug,
    oddsFormat: "candidates",
  });

  return `
    ${renderSectionHeadline("Governor", "", slug)}
    ${candidates}`;
}

function usesGovernorCandidateOdds(info) {
  return info.odds_format === "candidates";
}

function requiresPrimaryNominees(info) {
  return Boolean(info.nominee_slugs && Object.keys(info.nominee_slugs).length);
}

async function resolveGovernorNominees(info, parties) {
  const nominees = {};
  const incumbents = info.incumbents || {};

  await Promise.all(
    parties.map(async (party) => {
      const slug = info.nominee_slugs?.[party];
      const incumbentSurname = incumbents[party] ?? null;

      if (slug) {
        try {
          const nominee = await fetchNomineeSurname(slug, incumbentSurname);
          if (nominee) {
            nominees[party] = nominee;
            return;
          }
        } catch {
          // Fall through to incumbent-only fallback.
        }
      }

      if (incumbentSurname) {
        nominees[party] = { name: incumbentSurname, incumbent: true };
      }
    })
  );

  return nominees;
}

async function loadGovernorOdds(info) {
  if (!info.polymarket_slug) {
    return { format: "party", section: { parties: {} }, nominees: {} };
  }

  const primaryRequired = requiresPrimaryNominees(info);

  if (usesGovernorCandidateOdds(info) && !primaryRequired) {
    try {
      const section = await fetchPolymarketOdds(info.polymarket_slug, info.incumbent ?? null);
      return { format: "candidates", section };
    } catch {
      return { format: "candidates", section: { candidates: [], error: true } };
    }
  }

  try {
    const section = await fetchGovernorOdds(info.polymarket_slug);
    const parties = GOVERNOR_PARTY_ORDER.filter((party) => section.parties?.[party] != null);
    if (parties.length) {
      const nominees = await resolveGovernorNominees(info, parties);
      return { format: "party", section, nominees };
    }

    if (!primaryRequired) {
      const candidateSection = await fetchPolymarketOdds(info.polymarket_slug, info.incumbent ?? null);
      if (candidateSection.candidates.length) {
        return { format: "candidates", section: candidateSection };
      }
    }

    return { format: "party", section, nominees: {} };
  } catch {
    return { format: "party", section: { parties: {}, error: true }, nominees: {} };
  }
}

async function loadSenateOdds(info) {
  return loadGovernorOdds(info);
}

function ensurePopover() {
  if (popoverEl) return popoverEl;

  popoverEl = document.createElement("div");
  popoverEl.id = "primary-popover";
  popoverEl.className = "primary-popover";
  popoverEl.setAttribute("role", "dialog");
  popoverEl.hidden = true;
  document.body.appendChild(popoverEl);
  return popoverEl;
}

function positionPopover(trigger) {
  const popover = ensurePopover();
  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  const popoverRect = popover.getBoundingClientRect();

  let top = rect.bottom + margin;
  let left = rect.left;

  if (left + popoverRect.width > window.innerWidth - margin) {
    left = window.innerWidth - popoverRect.width - margin;
  }
  if (left < margin) left = margin;

  if (top + popoverRect.height > window.innerHeight - margin) {
    top = rect.top - popoverRect.height - margin;
  }

  popover.style.top = `${top + window.scrollY}px`;
  popover.style.left = `${left + window.scrollX}px`;
}

async function showPresidentialPopover(trigger) {
  const countryCode = trigger.dataset.presidential;
  const electionDate = trigger.dataset.primaryDate;
  const info = getPresidentialInfo(countryCode, electionDate);
  if (!info) return;

  const popover = ensurePopover();
  activeTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");

  popover.hidden = false;
  popover.innerHTML = `<p class="primary-popover__loading">Loading…</p>`;
  positionPopover(trigger);

  let section = { candidates: [] };
  if (info.polymarket_slug) {
    try {
      section = await fetchPolymarketOdds(info.polymarket_slug);
    } catch {
      section = { candidates: [], error: true };
    }
  }

  if (activeTrigger !== trigger) return;

  popover.innerHTML = renderPresidentialBody(info, section);
  positionPopover(trigger);
}

async function showDeStatePopover(trigger) {
  const stateCode = trigger.dataset.deState;
  const electionDate = trigger.dataset.primaryDate;
  const label = trigger.dataset.deStateLabel;
  const info = getDeStateInfo(stateCode, label, electionDate);
  if (!info) return;

  const popover = ensurePopover();
  activeTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");

  popover.hidden = false;
  popover.innerHTML = `<p class="primary-popover__loading">Loading…</p>`;
  positionPopover(trigger);

  const markets = normalizeElectionMarkets(info);
  const marketSections = await Promise.all(
    markets.map(async (market) => ({
      market,
      section: await loadElectionMarketSection(market, MIN_DE_STATE_POLYMARKET_PCT),
    }))
  );

  if (activeTrigger !== trigger) return;

  popover.innerHTML = renderStackedElectionBody(info.label || "State election", marketSections);
  positionPopover(trigger);
}

async function showGovernorPopover(trigger) {
  const stateCode = trigger.dataset.governor;
  const electionDate = trigger.dataset.primaryDate;
  const info = getGovernorInfo(stateCode, electionDate);
  if (!info) return;

  const popover = ensurePopover();
  activeTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");

  popover.hidden = false;
  popover.innerHTML = `<p class="primary-popover__loading">Loading…</p>`;
  positionPopover(trigger);

  const { format, section, nominees = {} } = await loadGovernorOdds(info);

  if (activeTrigger !== trigger) return;

  popover.innerHTML =
    format === "candidates"
      ? renderGovernorCandidateBody(section, info.polymarket_slug)
      : renderGovernorBody(section, nominees, info.polymarket_slug);
  positionPopover(trigger);
}

async function showNationalElectionPopover(trigger) {
  const countryCode = trigger.dataset.nationalElection;
  const contestLabel = trigger.dataset.nationalElectionLabel;
  const electionDate = trigger.dataset.primaryDate;
  const alternateLabels = (trigger.dataset.nationalElectionAlternates || "")
    .split("|")
    .filter(Boolean);
  const matchedLabel =
    resolveNationalElectionLabel(countryCode, contestLabel, electionDate, alternateLabels) ||
    contestLabel;
  const info = getNationalElectionInfo(countryCode, matchedLabel, electionDate);
  if (!info) return;

  const popover = ensurePopover();
  activeTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");

  popover.hidden = false;
  popover.innerHTML = `<p class="primary-popover__loading">Loading…</p>`;
  positionPopover(trigger);

  const markets = normalizeElectionMarkets(info);
  const marketSections = await Promise.all(
    markets.map(async (market) => ({
      market,
      section: await loadElectionMarketSection(market, MIN_NATIONAL_PARTY_POLYMARKET_PCT),
    }))
  );

  if (activeTrigger !== trigger) return;

  popover.innerHTML = renderStackedElectionBody(matchedLabel, marketSections);
  positionPopover(trigger);
}

async function showSenatePopover(trigger) {
  const stateCode = trigger.dataset.senate;
  const electionDate = trigger.dataset.primaryDate;
  const info = getSenateInfo(stateCode, electionDate);
  if (!info) return;

  const popover = ensurePopover();
  activeTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");

  popover.hidden = false;
  popover.innerHTML = `<p class="primary-popover__loading">Loading…</p>`;
  positionPopover(trigger);

  const { format, section, nominees = {} } = await loadSenateOdds(info);

  if (activeTrigger !== trigger) return;

  popover.innerHTML =
    format === "candidates"
      ? renderSenateCandidateBody(section, info.polymarket_slug)
      : renderSenateBody(section, nominees, info.polymarket_slug);
  positionPopover(trigger);
}

function renderSenateCandidateBody(section, slug = null) {
  const candidates = renderCandidateRows(section, {
    slug,
    oddsFormat: "candidates",
  });

  return `
    ${renderSectionHeadline("Senate", "", slug)}
    ${candidates}`;
}

async function showMayoralPopover(trigger) {
  const cityCode = trigger.dataset.mayoral || null;
  const countryCode = trigger.dataset.mayoralCountry || null;
  const electionDate = trigger.dataset.primaryDate;
  const info = getMayoralInfo(cityCode, electionDate, countryCode);
  if (!info) return;

  const popover = ensurePopover();
  activeTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");

  popover.hidden = false;
  popover.innerHTML = `<p class="primary-popover__loading">Loading…</p>`;
  positionPopover(trigger);

  let section = { candidates: [] };
  if (info.polymarket_slug) {
    try {
      section = await fetchPolymarketOdds(info.polymarket_slug, info.incumbent ?? null);
    } catch {
      section = { candidates: [], error: true };
    }
  }

  if (activeTrigger !== trigger) return;

  popover.innerHTML = renderPresidentialBody(info, section);
  positionPopover(trigger);
}

async function showPrimaryPopover(trigger, key) {
  const { stateCode, office } = parsePrimaryKey(key);
  const electionDate = trigger.dataset.primaryDate;
  const info = getPrimaryInfo(stateCode, office, electionDate);
  if (!info) return;

  const popover = ensurePopover();
  activeTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");

  popover.hidden = false;
  popover.innerHTML = `<p class="primary-popover__loading">Loading…</p>`;
  positionPopover(trigger);

  if (isCombinedBallotPrimary(info)) {
    let section = { candidates: [] };
    if (info.polymarket_slug) {
      try {
        section = await fetchPolymarketOdds(info.polymarket_slug);
      } catch {
        section = { candidates: [], error: true };
      }
    }

    if (activeTrigger !== trigger) return;

    popover.innerHTML = renderCombinedBallotBody(info, section);
    positionPopover(trigger);
    return;
  }

  const partyEntries = Object.entries(info.parties || {});
  const partySections = {};

  await Promise.all(
    partyEntries.map(async ([party, config]) => {
      partySections[party] = await loadPartySection(config);
    })
  );

  if (activeTrigger !== trigger) return;

  popover.innerHTML = renderPopoverBody(info, partySections);
  positionPopover(trigger);
}

async function showPopover(trigger) {
  if (trigger.dataset.presidential) {
    return showPresidentialPopover(trigger);
  }

  if (trigger.dataset.governor) {
    return showGovernorPopover(trigger);
  }

  if (trigger.dataset.senate) {
    return showSenatePopover(trigger);
  }

  if (trigger.dataset.mayoral || trigger.dataset.mayoralCountry) {
    return showMayoralPopover(trigger);
  }

  if (trigger.dataset.nationalElection) {
    return showNationalElectionPopover(trigger);
  }

  if (trigger.dataset.deState) {
    return showDeStatePopover(trigger);
  }

  const key = trigger.dataset.primary;
  if (!key) return;
  return showPrimaryPopover(trigger, key);
}

function hidePopover() {
  if (hoverCloseTimer) {
    clearTimeout(hoverCloseTimer);
    hoverCloseTimer = null;
  }

  if (activeTrigger) {
    activeTrigger.setAttribute("aria-expanded", "false");
    activeTrigger = null;
  }

  if (popoverEl) {
    popoverEl.hidden = true;
    popoverEl.innerHTML = "";
  }
}

function isFinePointer() {
  return (
    window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
    !window.matchMedia("(pointer: coarse)").matches
  );
}

function bindPopoverEvents(root) {
  root.addEventListener("click", (event) => {
    if (event.target.closest("a[href]")) return;

    const trigger = event.target.closest(".office-tag--interactive");
    if (trigger) {
      if (isFinePointer()) return;
      event.preventDefault();
      event.stopPropagation();
      if (activeTrigger === trigger && !popoverEl?.hidden) {
        hidePopover();
      } else {
        showPopover(trigger);
      }
      return;
    }

    if (!event.target.closest("#primary-popover")) {
      hidePopover();
    }
  });

  root.addEventListener("pointerenter", (event) => {
    if (!isFinePointer()) return;
    const trigger = event.target.closest(".office-tag--interactive");
    if (!trigger) return;

    if (hoverCloseTimer) {
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = null;
    }

    showPopover(trigger);
  }, true);

  root.addEventListener("pointerleave", (event) => {
    if (!isFinePointer()) return;
    const trigger = event.target.closest(".office-tag--interactive");
    if (!trigger) return;

    const related = event.relatedTarget;
    if (related?.closest?.("#primary-popover") || related?.closest?.(".office-tag--interactive")) {
      return;
    }

    hoverCloseTimer = setTimeout(hidePopover, 120);
  }, true);

  ensurePopover().addEventListener("pointerenter", () => {
    if (hoverCloseTimer) {
      clearTimeout(hoverCloseTimer);
      hoverCloseTimer = null;
    }
  });

  ensurePopover().addEventListener("pointerleave", () => {
    if (!isFinePointer()) return;
    hoverCloseTimer = setTimeout(hidePopover, 120);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hidePopover();
  });

  window.addEventListener("resize", hidePopover);
  window.addEventListener("scroll", hidePopover, true);
}

export function renderInteractiveOfficeTag(
  label,
  stateCode,
  electionDate,
  countryCode = null,
  cityCode = null,
  alternateLabels = []
) {
  if (isPresidentialLabel(label)) {
    const presidential = getPresidentialInfo(countryCode, electionDate);
    if (presidential) {
      return `<button type="button" class="office-tag office-tag--interactive" data-presidential="${countryCode}" data-primary-date="${electionDate || ""}" aria-expanded="false" aria-haspopup="dialog">${label}</button>`;
    }
    return `<span class="office-tag">${label}</span>`;
  }

  if (isMayorLabel(label)) {
    const info = getMayoralInfo(cityCode, electionDate, countryCode);
    if (info) {
      const lookupAttrs = [
        cityCode ? `data-mayoral="${cityCode}"` : "",
        countryCode ? `data-mayoral-country="${countryCode}"` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button type="button" class="office-tag office-tag--interactive" ${lookupAttrs} data-primary-date="${electionDate || ""}" aria-expanded="false" aria-haspopup="dialog">${label}</button>`;
    }
    return `<span class="office-tag">${label}</span>`;
  }

  if (isGovernorLabel(label) && getGovernorInfo(stateCode, electionDate)) {
    return `<button type="button" class="office-tag office-tag--interactive" data-governor="${stateCode}" data-primary-date="${electionDate || ""}" aria-expanded="false" aria-haspopup="dialog">${label}</button>`;
  }

  if (isSenateLabel(label) && getSenateInfo(stateCode, electionDate)) {
    return `<button type="button" class="office-tag office-tag--interactive" data-senate="${stateCode}" data-primary-date="${electionDate || ""}" aria-expanded="false" aria-haspopup="dialog">${label}</button>`;
  }

  if (countryCode === "DE" && getDeStateInfo(stateCode, label, electionDate)) {
    return `<button type="button" class="office-tag office-tag--interactive" data-de-state="${stateCode}" data-de-state-label="${label}" data-primary-date="${electionDate || ""}" aria-expanded="false" aria-haspopup="dialog">${label}</button>`;
  }

  const matchedNationalLabel = resolveNationalElectionLabel(
    countryCode,
    label,
    electionDate,
    alternateLabels
  );
  if (matchedNationalLabel) {
    const alternatesAttr = alternateLabels.length
      ? ` data-national-election-alternates="${alternateLabels.join("|")}"`
      : "";
    return `<button type="button" class="office-tag office-tag--interactive" data-national-election="${countryCode}" data-national-election-label="${matchedNationalLabel}"${alternatesAttr} data-primary-date="${electionDate || ""}" aria-expanded="false" aria-haspopup="dialog">${label}</button>`;
  }

  const office = labelToOffice(label);
  const info = getPrimaryInfo(stateCode, office, electionDate);

  if (!info) {
    return `<span class="office-tag">${label}</span>`;
  }

  const key = primaryKey(stateCode, office);
  return `<button type="button" class="office-tag office-tag--interactive" data-primary="${key}" data-primary-date="${electionDate || ""}" aria-expanded="false" aria-haspopup="dialog">${label}</button>`;
}

function prefetchPromise(promise) {
  promise.catch(() => {});
}

function prefetchElectionMarketOdds(market, partyMinPct) {
  if (!market.polymarket_slug) return;

  if (market.odds_format === "party") {
    prefetchPromise(fetchPolymarketPartyOdds(market.polymarket_slug, partyMinPct));
    return;
  }

  if (market.odds_format === "binary") {
    prefetchPromise(fetchPolymarketBinaryOdds(market.polymarket_slug, partyMinPct));
    return;
  }

  prefetchPromise(fetchPolymarketOdds(market.polymarket_slug));
}

function prefetchGovernorOddsForInfo(info) {
  if (!info?.polymarket_slug) return;

  if (usesGovernorCandidateOdds(info) && !requiresPrimaryNominees(info)) {
    prefetchPromise(fetchPolymarketOdds(info.polymarket_slug, info.incumbent ?? null));
    return;
  }

  prefetchPromise(
    fetchGovernorOdds(info.polymarket_slug).then(async (section) => {
      const parties = GOVERNOR_PARTY_ORDER.filter((party) => section.parties?.[party] != null);
      if (parties.length) {
        await Promise.all(
          parties.map(async (party) => {
            const slug = info.nominee_slugs?.[party];
            const incumbentSurname = info.incumbents?.[party] ?? null;
            if (slug) {
              prefetchPromise(fetchNomineeSurname(slug, incumbentSurname));
            }
          })
        );
        return;
      }

      prefetchPromise(fetchPolymarketOdds(info.polymarket_slug, info.incumbent ?? null));
    })
  );
}

export function prefetchOdds() {
  for (const info of Object.values(usGovernorInfo)) {
    prefetchGovernorOddsForInfo(info);
  }

  for (const info of Object.values(usSenateInfo)) {
    prefetchGovernorOddsForInfo(info);
  }

  for (const offices of Object.values(primaryInfo)) {
    for (const info of Object.values(offices)) {
      if (isCombinedBallotPrimary(info)) {
        if (info.polymarket_slug) {
          prefetchPromise(fetchPolymarketOdds(info.polymarket_slug));
        }
        continue;
      }

      for (const partyConfig of Object.values(info.parties || {})) {
        if (partyConfig.polymarket_slug) {
          prefetchPromise(fetchPolymarketOdds(partyConfig.polymarket_slug, partyConfig.incumbent));
        }
      }
    }
  }

  for (const info of Object.values(presidentialInfo)) {
    if (info.polymarket_slug) {
      prefetchPromise(fetchPolymarketOdds(info.polymarket_slug));
    }
  }

  for (const info of Object.values(deStateInfo)) {
    for (const market of normalizeElectionMarkets(info)) {
      prefetchElectionMarketOdds(market, MIN_DE_STATE_POLYMARKET_PCT);
    }
  }

  for (const info of Object.values(mayoralInfo)) {
    if (info.polymarket_slug) {
      prefetchPromise(fetchPolymarketOdds(info.polymarket_slug, info.incumbent ?? null));
    }
  }

  for (const contests of Object.values(nationalElectionInfo)) {
    for (const info of Object.values(contests)) {
      for (const market of normalizeElectionMarkets(info)) {
        prefetchElectionMarketOdds(market, MIN_NATIONAL_PARTY_POLYMARKET_PCT);
      }
    }
  }
}

export function initPrimaryPopovers(root = document.getElementById("timeline")) {
  if (!root) return;
  bindPopoverEvents(root);
}

function governorPartyCandidates(parties) {
  return GOVERNOR_PARTY_ORDER.filter((party) => parties?.[party] != null).map((party) => ({
    name: party,
    pct: parties[party],
  }));
}

export async function fetchDisplayOdds({
  slug,
  oddsFormat = "candidates",
  minPct = MIN_POLYMARKET_PCT,
}) {
  if (!slug) return [];

  if (oddsFormat === "party") {
    const { candidates } = await fetchPolymarketPartyOdds(slug, minPct);
    return candidates;
  }

  if (oddsFormat === "binary") {
    const { candidates } = await fetchPolymarketBinaryOdds(slug, minPct);
    return candidates;
  }

  const { candidates } = await fetchPolymarketOdds(slug);
  return candidates;
}

export async function fetchSuggestionOdds(item) {
  const slug = item.slug;
  if (!slug) return [];

  const oddsFormat = item.odds_format || "candidates";
  const minPct = item.min_pct ?? MIN_POLYMARKET_PCT;

  if (item.category === "us_governor" || item.category === "us_senate") {
    if (oddsFormat === "candidates") {
      const { candidates } = await fetchPolymarketOdds(slug);
      return candidates;
    }

    try {
      const { parties } = await fetchGovernorOdds(slug);
      const partyCandidates = governorPartyCandidates(parties);
      if (partyCandidates.length) return partyCandidates;
    } catch {
      // Fall through to candidate odds.
    }

    const { candidates } = await fetchPolymarketOdds(slug);
    return candidates;
  }

  return fetchDisplayOdds({ slug, oddsFormat, minPct });
}

export function matchSuggestionPrice(staticPrices, displayName, oddsFormat = "candidates") {
  for (const price of staticPrices || []) {
    if (price.name === displayName) return price;
    if (oddsFormat === "candidates" && surname(price.name) === displayName) return price;
  }
  return null;
}
