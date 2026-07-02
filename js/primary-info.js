const POLYMARKET_API = "https://gamma-api.polymarket.com/events";
const MIN_POLYMARKET_PCT = 3;

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

const PRIMARY_TYPE_LABELS = {
  open: "Open primary",
  "semi-closed": "Semi-closed primary",
  closed: "Closed primary",
  "top-two": "Top-two primary",
  party: "Party primaries",
};

let primaryInfo = {};
let primaryWindowMonths = 3;
const oddsCache = new Map();

let popoverEl = null;
let activeTrigger = null;
let hoverCloseTimer = null;

export async function loadPrimaryInfo() {
  try {
    const res = await fetch("data/curated/us_primary_info.json");
    if (!res.ok) return;
    const data = await res.json();
    if (data._window_months) {
      primaryWindowMonths = data._window_months;
    }
    delete data._comment;
    delete data._window_months;
    primaryInfo = data;
  } catch {
    primaryInfo = {};
  }
}

function isWithinPrimaryWindow(electionDate) {
  if (!electionDate) return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setMonth(end.getMonth() + primaryWindowMonths);

  const date = new Date(`${electionDate}T12:00:00`);
  return date >= today && date <= end;
}

export function getPrimaryInfo(stateCode, office, electionDate) {
  if (!stateCode || !office) return null;
  if (!isWithinPrimaryWindow(electionDate)) return null;
  return primaryInfo[stateCode]?.[office] ?? null;
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

function surname(name) {
  const parts = name.trim().split(/\s+/);
  if (!parts.length) return name;

  const last = parts[parts.length - 1].replace(/\./g, "").toLowerCase();
  if (NAME_SUFFIXES.has(last) && parts.length > 1) {
    return parts[parts.length - 2];
  }

  return parts[parts.length - 1];
}

function formatPercent(value) {
  return `${Math.round(value)}%`;
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
        const name = market.groupItemTitle;
        const pct = parseOutcomePrice(market.outcomePrices);
        if (!name || pct == null || name === "Other") return null;
        if (/^Candidate [A-Z]$/i.test(name)) return null;
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

function renderCandidateRows(section) {
  if (section.error) {
    return `<p class="primary-popover__empty">Could not load market data</p>`;
  }

  if (!section.candidates.length) {
    return "";
  }

  return `<ul class="primary-popover__candidates">${section.candidates
    .map((candidate) => {
      const pct =
        candidate.pct != null
          ? `<span class="primary-popover__pct">${formatPercent(candidate.pct)}</span>`
          : "";
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

function renderTypeHeader(info) {
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

  return `
    <p class="primary-popover__type">
      <span class="primary-popover__type-label">${typeLabel}</span>${infoIcon}
    </p>`;
}

function renderPopoverBody(info, partySections) {
  const partyBlocks = Object.entries(partySections)
    .filter(([, section]) => section.candidates.length || section.error)
    .map(([party, section]) => {
      const candidateRows = renderCandidateRows(section);
      if (!candidateRows && !section.error) return "";

      return `
        <div class="primary-popover__party">
          <div class="primary-popover__party-head">
            <span class="primary-popover__party-name primary-popover__party-name--${partySlug(party)}">${party}</span>
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

function renderTopFourBody(info, section) {
  const candidates = renderCandidateRows(section);

  return `
    ${renderTypeHeader(info)}
    ${candidates}`;
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

async function showPopover(trigger, key) {
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

  if (info.primary_format === "top-four") {
    let section = { candidates: [] };
    if (info.polymarket_slug) {
      try {
        section = await fetchPolymarketOdds(info.polymarket_slug);
      } catch {
        section = { candidates: [], error: true };
      }
    }

    if (activeTrigger !== trigger) return;

    popover.innerHTML = renderTopFourBody(info, section);
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
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function bindPopoverEvents(root) {
  root.addEventListener("click", (event) => {
    const trigger = event.target.closest(".office-tag--interactive");
    if (trigger) {
      if (isFinePointer()) return;
      event.preventDefault();
      event.stopPropagation();
      const key = trigger.dataset.primary;
      if (activeTrigger === trigger && !popoverEl?.hidden) {
        hidePopover();
      } else {
        showPopover(trigger, key);
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

    showPopover(trigger, trigger.dataset.primary);
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

export function renderInteractiveOfficeTag(label, stateCode, electionDate) {
  const office = labelToOffice(label);
  const info = getPrimaryInfo(stateCode, office, electionDate);

  if (!info) {
    return `<span class="office-tag">${label}</span>`;
  }

  const key = primaryKey(stateCode, office);
  return `<button type="button" class="office-tag office-tag--interactive" data-primary="${key}" data-primary-date="${electionDate || ""}" aria-expanded="false" aria-haspopup="dialog">${label}</button>`;
}

export function initPrimaryPopovers(root = document.getElementById("timeline")) {
  if (!root) return;
  bindPopoverEvents(root);
}
