import { flagUrl, flagAlt } from "./flags.js";

const GROUP_LABELS = {
  all: "All",
  oecd: "OECD",
  brics: "BRICS",
  major: "Major",
  US: "United States",
  DE: "Germany",
};

const LEVEL_LABELS = {
  federal: "Federal",
  state: "State",
};

let allElections = [];
let activeGroup = "all";
let searchQuery = "";
let hideStates = false;

async function init() {
  const electionsRes = await fetch("data/elections.json");
  allElections = await electionsRes.json();

  render();
  bindEvents();
}

function bindEvents() {
  document.getElementById("search").addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    render();
  });

  document.getElementById("toggle-states").addEventListener("change", (e) => {
    hideStates = !e.target.checked;
    render();
  });
}

function electionHaystack(election) {
  const sectionStates = (election.sections || [])
    .flatMap((section) => section.states || [])
    .flatMap((state) => [state.name, ...(state.offices || [])]);

  return [
    election.country,
    election.state,
    election.title,
    election.type,
    election.party,
    election.notes,
    ...(election.offices || []),
    ...(election.labels || []),
    ...sectionStates,
    LEVEL_LABELS[election.level],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function filterElections() {
  return allElections.filter((election) => {
    if (hideStates) {
      if (election.level === "state") return false;
      if (
        election.sections?.length &&
        !election.sections.some((section) => section.level === "federal")
      ) {
        return false;
      }
    }

    if (activeGroup !== "all") {
      if (activeGroup === "US" || activeGroup === "DE") {
        if (election.country_code !== activeGroup) return false;
      } else if (!election.groups?.includes(activeGroup)) {
        return false;
      }
    }

    if (searchQuery && !electionHaystack(election).includes(searchQuery)) {
      return false;
    }

    return true;
  });
}

const OFFICE_PRIMARY_LABEL = {
  Governor: "Governor Primary",
  Senate: "Senate Primary",
};

const UMBRELLA_TITLES = {
  midterm: "Midterms",
  general: "General",
  state: "State",
};

const OFFICE_ORDER = ["Governor", "Senate"];

const PARTY_ORDER = ["Democratic", "Republican"];

function mergeKey(election) {
  return `${election.date}|${election.country_code}|${election.state_code || ""}`;
}

function compactPrimaryLabels(items) {
  const primaries = items.filter((item) => item.type === "primary");
  const runoffs = items.filter((item) => item.type === "runoff");
  const labels = [];

  const partiesByOffice = new Map();
  for (const item of primaries) {
    if (!item.party) continue;
    for (const office of item.offices || []) {
      if (!partiesByOffice.has(office)) partiesByOffice.set(office, new Set());
      partiesByOffice.get(office).add(item.party);
    }
  }

  for (const office of OFFICE_ORDER) {
    const parties = partiesByOffice.get(office);
    if (!parties) continue;

    const hasBothMajorParties =
      parties.has("Democratic") && parties.has("Republican");
    if (hasBothMajorParties) {
      labels.push(OFFICE_PRIMARY_LABEL[office] || `${office} Primary`);
      continue;
    }

    for (const party of PARTY_ORDER.filter((p) => parties.has(p))) {
      const officeName = office === "Governor" ? "Governor" : office;
      labels.push(`${party} ${officeName} Primary`);
    }
  }

  for (const item of [...runoffs].sort((a, b) => a.title.localeCompare(b.title))) {
    const office = (item.offices || [])[0];
    const officeName = office === "Governor" ? "Governor" : office || "Primary";
    labels.push(`${item.party} ${officeName} Primary Runoff`);
  }

  return labels;
}

function primaryEventTitle(offices = []) {
  const parts = OFFICE_ORDER.filter((office) => offices.includes(office));
  if (!parts.length) return "Primaries";
  return `${parts.join("/")} primaries`;
}

function locationPrefix(election) {
  if (election.state) return election.state;
  return election.country;
}

function stripElectionFromTitle(title) {
  const roundMatch = title.match(/^(.+?)\s+Election(\s+—\s+Round\s+\d+)$/i);
  if (roundMatch) {
    return `${roundMatch[1]}${roundMatch[2]}`;
  }

  const stripped = title
    .replace(/\s+Elections$/i, "")
    .replace(/\s+Election$/i, "");
  return UMBRELLA_TITLES[stripped.toLowerCase()] || stripped;
}

function formatEventTitle(election) {
  const loc = locationPrefix(election);

  if (election.mergedPrimary) {
    return `${loc} ${primaryEventTitle(election.offices)}`;
  }

  if (election.country_code === "DE" && election.state && election.level === "state") {
    const body = (election.offices || [])[0];
    if (body) return `${election.state} ${body}`;
  }

  return `${loc} ${stripElectionFromTitle(election.title)}`;
}

function mergeLabels(items) {
  const sorted = [...items].sort((a, b) => a.title.localeCompare(b.title));
  const isPrimaryGroup =
    sorted.every((item) => item.type === "primary" || item.type === "runoff") &&
    sorted.some((item) => item.party);

  if (isPrimaryGroup) {
    const compact = compactPrimaryLabels(sorted);
    if (compact.length) return compact;
  }

  return sorted.map((item) => item.title);
}

function mergeElectionGroups(elections) {
  const groups = new Map();
  for (const election of elections) {
    if (election.sections?.length) {
      groups.set(`${election.date}|${election.country_code}|combined`, [election]);
      continue;
    }

    const key = mergeKey(election);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(election);
  }

  return [...groups.values()].map((items) => {
    if (items.length === 1) return items[0];

    const sorted = [...items].sort((a, b) => a.title.localeCompare(b.title));
    const base = sorted[0];
    const isEstimated = items.some((e) => e.date_precision === "estimated");
    const offices = [...new Set(items.flatMap((e) => e.offices || []))];
    const labels = mergeLabels(items);
    const notes = [...new Set(items.map((e) => e.notes).filter(Boolean))];
    const isMergedPrimary = items.every(
      (item) => item.type === "primary" || item.type === "runoff"
    );

    return {
      ...base,
      offices,
      labels,
      mergedPrimary: isMergedPrimary,
      date_precision: isEstimated ? "estimated" : base.date_precision,
      notes: notes.length ? notes.join(" · ") : undefined,
    };
  });
}

function hasMixedLevelSections(sections) {
  const levels = new Set(sections.map((section) => section.level));
  return levels.has("federal") && levels.has("state");
}

function resolveCardDisplay(election) {
  const labels = (election.labels || []).join(" · ");
  const sections = visibleSections(election);
  const hasSections = sections.length > 0;
  const hasLabels = Boolean(labels);
  const showMeta = !hasSections && !hasLabels;

  return {
    title: formatEventTitle(election),
    labels,
    sections,
    showMeta,
    offices: election.offices || [],
  };
}

function visibleSections(election) {
  if (!election.sections?.length) return [];
  if (!hideStates) return election.sections;
  return election.sections.filter((section) => section.level !== "state");
}

function getDisplayElections() {
  return mergeElectionGroups(filterElections());
}

function groupByMonth(elections) {
  const groups = new Map();
  for (const election of elections) {
    const d = new Date(election.date + "T12:00:00");
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (!groups.has(key)) groups.set(key, { label, items: [] });
    groups.get(key).items.push(election);
  }

  for (const group of groups.values()) {
    group.items.sort((a, b) => {
      const levelOrder = { federal: 0, state: 1 };
      const levelDiff = (levelOrder[a.level] ?? 2) - (levelOrder[b.level] ?? 2);
      if (levelDiff !== 0) return levelDiff;
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.state || a.country).localeCompare(b.state || b.country);
    });
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function formatCardDate(election) {
  const d = new Date(election.date + "T12:00:00");
  const isEstimated = election.date_precision === "estimated";

  return {
    day: isEstimated ? "tbd" : d.getDate(),
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

function renderOfficeTags(offices = []) {
  return offices
    .map((office) => `<span class="office-tag">${office}</span>`)
    .join("");
}

function renderSections(election) {
  const sections = visibleSections(election);
  if (!sections.length) return "";

  const showSectionLabels = hasMixedLevelSections(sections);

  return `<div class="card-sections">${sections
    .map((section) => {
      const sectionLabel = showSectionLabels
        ? `<div class="section-label">${section.label}</div>`
        : "";

      if (section.states?.length) {
        return `
          <div class="election-section">
            ${sectionLabel}
            <div class="state-list">
              ${section.states
                .map(
                  (state) => `
                <div class="state-row">
                  <span class="state-name">${state.name}</span>
                  <div class="state-offices">${renderOfficeTags(state.offices)}</div>
                </div>`
                )
                .join("")}
            </div>
          </div>`;
      }

      return `
        <div class="election-section">
          ${sectionLabel}
          <div class="section-offices">${renderOfficeTags(section.offices)}</div>
        </div>`;
    })
    .join("")}</div>`;
}

function renderCard(election) {
  const { day, weekday, full, isEstimated } = formatCardDate(election);
  const { title, labels, sections, showMeta, offices } = resolveCardDisplay(election);
  const officeTags = showMeta ? renderOfficeTags(offices) : "";

  return `
    <article class="card${sections.length ? " card-combined" : ""}${election.mergedPrimary ? " card-primary" : ""}">
      <img class="card-flag" src="${flagUrl(election)}" alt="${flagAlt(election)}" width="30" height="20" loading="lazy" />
      <div class="card-date">
        <div class="card-day${isEstimated ? " card-day-tbd" : ""}">${day}</div>
        <div class="card-weekday">${weekday}</div>
      </div>
      <div class="card-body">
        <div class="card-topline">
          <h3 class="card-title">${title}</h3>
          ${isEstimated ? '<span class="badge badge-estimated">Est.</span>' : ""}
        </div>
        ${labels ? `<p class="card-labels">${labels}</p>` : ""}
        ${sections.length ? renderSections(election) : showMeta ? `<div class="card-meta">${officeTags}</div>` : ""}
        ${election.notes ? `<p class="card-notes">${election.notes}</p>` : ""}
      </div>
      <time class="card-time" datetime="${election.date}">${full}</time>
    </article>
  `;
}

function render() {
  const filtered = getDisplayElections();
  const timeline = document.getElementById("timeline");

  if (!filtered.length) {
    timeline.innerHTML = `<p class="empty">No elections match your filters.</p>`;
    return;
  }

  const groups = groupByMonth(filtered);
  timeline.innerHTML = groups
    .map(
      ([, { label, items }]) => `
      <div class="month-group">
        <h2 class="month-heading">${label}</h2>
        <div class="cards">${items.map(renderCard).join("")}</div>
      </div>
    `
    )
    .join("");
}

init();
