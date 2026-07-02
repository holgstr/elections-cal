const POLYMARKET_API = "https://gamma-api.polymarket.com/events";

const PRIMARY_TYPE_LABELS = {
  open: "Open primary",
  "semi-closed": "Semi-closed primary",
  closed: "Closed primary",
  "top-two": "Top-two primary",
  party: "Party primaries",
};

let primaryInfo = {};
const oddsCache = new Map();

let popoverEl = null;
let activeTrigger = null;
let hoverCloseTimer = null;

export async function loadPrimaryInfo() {
  try {
    const res = await fetch("data/curated/us_primary_info.json");
    if (!res.ok) return;
    primaryInfo = await res.json();
    delete primaryInfo._comment;
  } catch {
    primaryInfo = {};
  }
}

export function labelToOffice(label) {
  const match = label.match(/^(?:(?:Democratic|Republican)\s+)?(Governor|Senate)\s+Primary(?:\s+Runoff)?$/i);
  return match ? match[1] : null;
}

export function getPrimaryInfo(stateCode, office) {
  if (!stateCode || !office) return null;
  return primaryInfo[stateCode]?.[office] ?? null;
}

export function hasPrimaryInfo(stateCode, label) {
  const office = labelToOffice(label);
  return Boolean(getPrimaryInfo(stateCode, office));
}

function primaryKey(stateCode, office) {
  return `${stateCode}:${office}`;
}

function parsePrimaryKey(key) {
  const [stateCode, office] = key.split(":");
  return { stateCode, office };
}

function formatPercent(value) {
  if (value >= 10) return `${Math.round(value)}%`;
  if (value >= 1) return `${value.toFixed(1)}%`;
  if (value >= 0.1) return `${value.toFixed(1)}%`;
  return "<0.1%";
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

async function fetchPolymarketOdds(slug) {
  if (oddsCache.has(slug)) return oddsCache.get(slug);

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
        return { name, pct };
      })
      .filter(Boolean)
      .filter((c) => c.pct >= 0.05)
      .sort((a, b) => b.pct - a.pct);

    return { source: "Polymarket", candidates };
  })();

  oddsCache.set(slug, promise);
  return promise;
}

async function loadPartySection(party, config) {
  if (config.polymarket_slug) {
    try {
      return await fetchPolymarketOdds(config.polymarket_slug);
    } catch {
      return { source: "Polymarket", candidates: [], error: true };
    }
  }

  if (config.candidates?.length) {
    return { source: null, candidates: config.candidates };
  }

  return { source: null, candidates: [] };
}

function renderCandidateRows(section) {
  if (section.error) {
    return `<p class="primary-popover__empty">Could not load market data</p>`;
  }

  if (!section.candidates.length) {
    return `<p class="primary-popover__empty">No market data yet</p>`;
  }

  return `<ul class="primary-popover__candidates">${section.candidates
    .map((candidate) => {
      const pct =
        candidate.pct != null
          ? `<span class="primary-popover__pct">${formatPercent(candidate.pct)}</span>`
          : candidate.note
            ? `<span class="primary-popover__note">${candidate.note}</span>`
            : "";
      return `<li><span class="primary-popover__name">${candidate.name}</span>${pct}</li>`;
    })
    .join("")}</ul>`;
}

function renderPopoverBody(info, partySections) {
  const typeLabel =
    info.primary_type_label ||
    PRIMARY_TYPE_LABELS[info.primary_type] ||
    info.primary_type;

  const formatNote =
    info.primary_format === "open"
      ? "All candidates appear on one ballot; voters are not limited by party registration."
      : info.primary_type_note || "";

  const partyBlocks = Object.entries(partySections)
    .map(([party, section]) => {
      const source = section.source
        ? `<span class="primary-popover__source">via ${section.source}</span>`
        : "";
      return `
        <div class="primary-popover__party">
          <div class="primary-popover__party-head">
            <span class="primary-popover__party-name">${party}</span>
            ${source}
          </div>
          ${renderCandidateRows(section)}
        </div>`;
    })
    .join("");

  return `
    <p class="primary-popover__type">${typeLabel}</p>
    ${formatNote ? `<p class="primary-popover__note-block">${formatNote}</p>` : ""}
    <div class="primary-popover__parties">${partyBlocks}</div>`;
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
  const info = getPrimaryInfo(stateCode, office);
  if (!info) return;

  const popover = ensurePopover();
  activeTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");

  popover.hidden = false;
  popover.innerHTML = `<p class="primary-popover__loading">Loading…</p>`;
  positionPopover(trigger);

  const partyEntries = Object.entries(info.parties || {});
  const partySections = {};

  await Promise.all(
    partyEntries.map(async ([party, config]) => {
      partySections[party] = await loadPartySection(party, config);
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

export function renderInteractiveOfficeTag(label, stateCode) {
  const office = labelToOffice(label);
  const info = getPrimaryInfo(stateCode, office);

  if (!info) {
    return `<span class="office-tag">${label}</span>`;
  }

  const key = primaryKey(stateCode, office);
  return `<button type="button" class="office-tag office-tag--interactive" data-primary="${key}" aria-expanded="false" aria-haspopup="dialog">${label}</button>`;
}

export function initPrimaryPopovers(root = document.getElementById("timeline")) {
  if (!root) return;
  bindPopoverEvents(root);
}
