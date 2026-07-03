const v = globalThis.__ECAL_V__ ?? "4";

const { flagUrl, flagAlt, stateFlagUrl, stateFlagAlt } = await import(`./flags.js?v=${v}`);
const { fetchJson } = await import(`./fetch-json.js?v=${v}`);
const {
  loadPrimaryInfo,
  initPrimaryPopovers,
  renderInteractiveOfficeTag,
  labelToOffice,
  isPresidentialLabel,
  isMayorLabel,
  prefetchOdds,
  isSenateLabel,
  getNationalElectionInfo,
} = await import(`./primary-info.js?v=${v}`);
const {
  loadSuggestionsData,
  renderSuggestions,
  suggestionsFooterText,
} = await import(`./suggestions.js?v=${v}`);

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
  local: "Local",
};

const UMBRELLA_TITLES = {
  midterm: "Midterms",
  general: "General",
  state: "State",
};

const COUNTRY_ADJECTIVES = {
  albania: ["albanian"],
  algeria: ["algerian"],
  angola: ["angolan"],
  "bosnia and herzegovina": ["bosnian"],
  "czech republic": ["czech"],
  czechia: ["czech"],
  "el salvador": ["salvadoran"],
  france: ["french"],
  haiti: ["haitian"],
  kazakhstan: ["kazakh", "kazakhstani"],
  kenya: ["kenyan"],
  latvia: ["latvian"],
  morocco: ["moroccan"],
  nicaragua: ["nicaraguan"],
  nigeria: ["nigerian"],
  russia: ["russian"],
  slovakia: ["slovak"],
  "sri lanka": ["sri lankan", "lankan"],
  tajikistan: ["tajik", "tajikistani"],
};

const CANONICAL_CONTEST_TITLES = {
  presidential: "President",
  parliamentary: "Parliament",
  legislative: "Parliament",
};

const PRESIDENTIAL_ROUND_RE = /^Presidential(\s+—\s+Round\s+\d+)$/i;

const COUNTRY_STATE_DAY_TITLES = {
  US: "US State primaries",
  DE: "German State primaries",
};

const ELECTION_COMMENTS = {
  snap_election: "Snap election",
};

function electionCommentLabel(comment) {
  return ELECTION_COMMENTS[comment] || null;
}

let allElections = [];
let activeGroup = "all";
let activeTab = "calendar";
let searchQuery = "";
let hideStates = false;
let hideLocal = false;

async function loadData() {
  const [meta, elections] = await Promise.all([
    fetchJson("data/meta.json"),
    fetchJson("data/elections.json"),
    loadPrimaryInfo(fetchJson),
    loadSuggestionsData(fetchJson),
  ]);
  allElections = elections;
  updateFooter(meta);
}

function updateFooter(meta) {
  const footer = document.getElementById("footer-meta");
  if (!footer) return;

  if (activeTab === "suggestions") {
    footer.textContent = suggestionsFooterText();
    return;
  }

  if (meta?.generated_at) {
    footer.textContent = `Updated ${meta.generated_at} · ${meta.count} elections in window`;
  }
}

async function fetchLiveSiteRev() {
  const res = await fetch(`data/site-rev.json?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) return null;
  const data = await res.json();
  return data.rev ?? null;
}

async function reloadIfSiteRevChanged(liveRev) {
  if (!liveRev || liveRev === v || new URLSearchParams(location.search).has("_")) return false;
  sessionStorage.setItem("ecal_site_rev", liveRev);
  location.replace(`${location.pathname}?_=${Date.now()}`);
  return true;
}

async function init() {
  try {
    const liveRev = await fetchLiveSiteRev();
    if (await reloadIfSiteRevChanged(liveRev)) return;
  } catch {}

  await loadData();
  prefetchOdds();
  render();
  bindEvents();
  initPrimaryPopovers();
}

window.addEventListener("pageshow", async (event) => {
  if (!event.persisted) return;

  try {
    const liveRev = await fetchLiveSiteRev();
    if (await reloadIfSiteRevChanged(liveRev)) return;
  } catch {}

  loadData().then(() => {
    prefetchOdds();
    render();
  });
});

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible") return;

  try {
    const liveRev = await fetchLiveSiteRev();
    if (await reloadIfSiteRevChanged(liveRev)) return;
    await loadData();
    prefetchOdds();
    render();
  } catch {}
});

function bindEvents() {
  document.getElementById("search").addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    render();
  });

  document.getElementById("toggle-states").addEventListener("change", (e) => {
    hideStates = !e.target.checked;
    render();
  });

  document.getElementById("toggle-local").addEventListener("change", (e) => {
    hideLocal = !e.target.checked;
    render();
  });

  for (const button of document.querySelectorAll(".tab-btn")) {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tab);
    });
  }
}

function setActiveTab(tab) {
  if (!tab || tab === activeTab) return;
  activeTab = tab;

  for (const button of document.querySelectorAll(".tab-btn")) {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  }

  for (const panel of document.querySelectorAll(".tab-panel")) {
    const isActive = panel.dataset.panel === tab;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  }

  const toolbar = document.getElementById("calendar-toolbar");
  if (toolbar) toolbar.hidden = tab !== "calendar";

  if (tab === "suggestions") {
    renderSuggestions(document.getElementById("suggestions"));
  } else {
    render();
  }

  fetchJson("data/meta.json")
    .then(updateFooter)
    .catch(() => updateFooter());
}

function electionHaystack(election) {
  const sectionStates = (election.sections || [])
    .flatMap((section) => section.states || [])
    .flatMap((state) => [state.name, ...(state.offices || [])]);

  return [
    election.country,
    election.state,
    election.city,
    election.title,
    election.type,
    election.party,
    election.comment,
    electionCommentLabel(election.comment),
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

    if (hideLocal && election.level === "local") return false;

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

const OFFICE_ORDER = ["Governor", "Senate"];
const MIDTERM_OFFICE_ORDER = ["Governor", "State Legislature", "Senate"];

const PARTY_ORDER = ["Democratic", "Republican"];

function mergeKey(election) {
  return `${election.date}|${election.country_code}|${election.state_code || election.city_code || ""}`;
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

function locationPrefix(election) {
  if (election.city) return election.city;
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

function countryAdjectives(country) {
  const lower = country.toLowerCase();
  if (COUNTRY_ADJECTIVES[lower]) return COUNTRY_ADJECTIVES[lower];

  const adjectives = [];
  const words = lower.split(/\s+/);
  const root = words[0];
  adjectives.push(root, `${root}ian`, `${root}ish`, `${root}ese`);

  if (root.endsWith("o")) adjectives.push(`${root.slice(0, -1)}an`);
  if (root.endsWith("a")) adjectives.push(`${root.slice(0, -1)}ian`);
  if (root.endsWith("i")) adjectives.push(`${root}an`);

  if (words.length > 1) {
    const last = words[words.length - 1];
    adjectives.push(`${last}an`, `${last}ian`, [...words.slice(0, -1), `${last}an`].join(" "));
  }

  return [...new Set(adjectives)];
}

function canonicalizeContestTitle(title, electionType = "general") {
  const roundMatch = title.trim().match(PRESIDENTIAL_ROUND_RE);
  if (roundMatch) return `President${roundMatch[1]}`;

  const lower = title.toLowerCase().trim();
  if (CANONICAL_CONTEST_TITLES[lower]) return CANONICAL_CONTEST_TITLES[lower];

  if (lower === "general") {
    if (electionType === "presidential") return "President";
    if (electionType === "legislative" || electionType === "general") return "Parliament";
  }

  return title;
}

function stripNationalityPrefix(title, country) {
  let cleaned = title.replace(/^next\s+/i, "").trim();
  if (!cleaned) return cleaned;

  for (const adjective of countryAdjectives(country)) {
    if (cleaned.toLowerCase().startsWith(`${adjective} `)) {
      cleaned = cleaned.slice(adjective.length).trim();
      break;
    }
  }

  if (cleaned && cleaned[0] === cleaned[0].toLowerCase()) {
    cleaned = cleaned[0].toUpperCase() + cleaned.slice(1);
  }

  return cleaned;
}

function contestNameFromSection(section, country, electionType = "general") {
  if (section.states?.length) return null;

  const label = stripElectionFromTitle(section.label || "");
  if (label && label !== "Federal" && label !== "State") {
    const sectionType =
      section.offices?.includes("President") || /presidential/i.test(label)
        ? "presidential"
        : electionType;
    return canonicalizeContestTitle(
      stripNationalityPrefix(label, country),
      sectionType
    );
  }
  return (section.offices || [])[0] || label || null;
}

function contestLabelFromTitle(election) {
  const raw = stripElectionFromTitle(election.title);
  if (!raw || Object.values(UMBRELLA_TITLES).includes(raw)) return null;
  return canonicalizeContestTitle(
    stripNationalityPrefix(raw, election.country),
    election.type
  );
}

function contestLabelsFromSections(sections, country, electionType = "general") {
  return sections
    .map((section) => contestNameFromSection(section, country, electionType))
    .filter(Boolean);
}

function stateSectionCount(sections = []) {
  return sections
    .filter((section) => section.level === "state")
    .reduce((count, section) => count + (section.states?.length || 0), 0);
}

function isMultiStateStateDay(election, sections = []) {
  if (election.multiStateDay) return true;
  if (election.title !== "State") return false;
  if (sections.some((section) => section.level === "federal")) return false;
  return stateSectionCount(sections) > 1;
}

function multiStateDayTitle(election) {
  return (
    COUNTRY_STATE_DAY_TITLES[election.country_code] ||
    `${election.country} State elections`
  );
}

function formatEventTitle(election, { sections }) {
  if (election.title === "Midterms") return "US midterms";

  if (isMultiStateStateDay(election, sections)) {
    return multiStateDayTitle(election);
  }

  return locationPrefix(election);
}

function stateOfficeLabels(election) {
  if (election.labels?.length) return election.labels;

  const offices = election.offices || [];
  if (
    election.mergedPrimary ||
    election.type === "primary" ||
    election.type === "runoff"
  ) {
    const labels = [];
    for (const office of OFFICE_ORDER) {
      if (!offices.includes(office)) continue;
      labels.push(OFFICE_PRIMARY_LABEL[office] || `${office} Primary`);
    }
    if (labels.length) return labels;

    const label = contestLabelFromTitle(election);
    return label ? [label] : offices;
  }

  return offices;
}

function titleCoversOffices(title, offices = [], election = {}) {
  if (!offices.length) return false;
  if (election.type === "presidential" && /president/i.test(title)) return true;
  return offices.every((office) => title.includes(office));
}

function shouldShowSections(election, sections) {
  if (!sections.length) return false;
  if (election.title === "Midterms") return true;
  if (hasMixedLevelSections(sections)) return true;
  if (sections.some((section) => section.states?.length)) return true;
  return false;
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

function isAggregatableStateElection(election) {
  if (election.sections?.length) return false;
  if (election.level !== "state" || !election.state) return false;
  return true;
}

function aggregateMultiStateElections(elections) {
  const passthrough = [];
  const buckets = new Map();

  for (const election of elections) {
    if (!isAggregatableStateElection(election)) {
      passthrough.push(election);
      continue;
    }

    const key = `${election.date}|${election.country_code}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(election);
  }

  const aggregated = [];
  for (const items of buckets.values()) {
    const stateCodes = new Set(items.map((item) => item.state_code).filter(Boolean));
    if (stateCodes.size < 2) {
      aggregated.push(...items);
      continue;
    }

    const sorted = [...items].sort((a, b) => (a.state || "").localeCompare(b.state || ""));
    const base = sorted[0];
    const isPrimaryDay = sorted.every(
      (item) =>
        item.mergedPrimary || item.type === "primary" || item.type === "runoff"
    );

    aggregated.push({
      ...base,
      state: null,
      state_code: null,
      title: "State",
      level: "state",
      labels: [],
      multiStateDay: true,
      isPrimaryDay,
      sections: [
        {
          label: "State",
          level: "state",
          states: sorted.map((item) => ({
            name: item.state,
            code: item.state_code,
            offices: stateOfficeLabels(item),
          })),
        },
      ],
    });
  }

  return [...passthrough, ...aggregated];
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
    const comments = [...new Set(items.map((e) => e.comment).filter(Boolean))];
    const isMergedPrimary = items.every(
      (item) => item.type === "primary" || item.type === "runoff"
    );

    return {
      ...base,
      offices,
      labels,
      mergedPrimary: isMergedPrimary,
      date_precision: isEstimated ? "estimated" : base.date_precision,
      comment: comments.length === 1 ? comments[0] : undefined,
    };
  });
}

function hasMixedLevelSections(sections) {
  const levels = new Set(sections.map((section) => section.level));
  return levels.has("federal") && levels.has("state");
}

function nationalElectionLabelCandidates(election) {
  const candidates = [];
  const titleLabel = contestLabelFromTitle(election);
  if (titleLabel) candidates.push(titleLabel);

  for (const office of election.offices || []) {
    if (!candidates.includes(office)) candidates.push(office);
  }

  for (const section of election.sections || []) {
    for (const office of section.offices || []) {
      if (!candidates.includes(office)) candidates.push(office);
    }
    const sectionLabel = contestNameFromSection(section, election.country, election.type);
    if (sectionLabel && !candidates.includes(sectionLabel)) {
      candidates.push(sectionLabel);
    }
  }

  return candidates;
}

function resolveNationalElectionDisplayLabel(election) {
  if (!election.country_code || election.state_code) return null;

  for (const label of nationalElectionLabelCandidates(election)) {
    if (getNationalElectionInfo(election.country_code, label, election.date)) {
      return label;
    }
  }

  return null;
}

function resolveCardLabels(election, sections, hasSections) {
  if (hasSections) return [];

  if (election.labels?.length) return election.labels;

  if (sections.length) {
    return contestLabelsFromSections(sections, election.country, election.type);
  }

  if (election.country_code === "DE" && election.state) {
    const body = (election.offices || [])[0];
    return body ? [body] : [];
  }

  if (election.state && election.country_code === "US") {
    const label = contestLabelFromTitle(election);
    return label ? [label] : [];
  }

  const nationalLabel = resolveNationalElectionDisplayLabel(election);
  if (nationalLabel) return [nationalLabel];

  const label = contestLabelFromTitle(election);
  if (label) return [label];

  return election.offices?.length ? [election.offices[0]] : [];
}

function resolveCardDisplay(election) {
  const sections = visibleSections(election);
  const hasSections = shouldShowSections(election, sections);
  const labels = resolveCardLabels(election, sections, hasSections);
  const title = formatEventTitle(election, { sections });
  const showMeta =
    !hasSections &&
    !labels.length &&
    !titleCoversOffices(title, election.offices, election);

  return {
    title,
    labels,
    sections: hasSections ? sections : [],
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
  return aggregateMultiStateElections(mergeElectionGroups(filterElections()));
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
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.state || a.city || a.country).localeCompare(b.state || b.city || b.country);
    });
  }

  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function formatCardDate(election) {
  const d = new Date(election.date + "T12:00:00");
  const isEstimated = election.date_precision === "estimated";

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

function tagNeedsInteractivity(
  label,
  stateCode,
  countryCode,
  cityCode,
  electionDate = null,
  alternateLabels = []
) {
  return (
    stateCode ||
    cityCode ||
    (isPresidentialLabel(label) && countryCode) ||
    (isMayorLabel(label) && (cityCode || countryCode)) ||
    (isSenateLabel(label) && stateCode) ||
    Boolean(getNationalElectionInfo(countryCode, label, electionDate, alternateLabels))
  );
}

function renderOfficeTag(
  label,
  stateCode = null,
  electionDate = null,
  countryCode = null,
  cityCode = null,
  alternateLabels = []
) {
  if (tagNeedsInteractivity(label, stateCode, countryCode, cityCode, electionDate, alternateLabels)) {
    return renderInteractiveOfficeTag(
      label,
      stateCode,
      electionDate,
      countryCode,
      cityCode,
      alternateLabels
    );
  }
  return `<span class="office-tag">${label}</span>`;
}

function renderOfficeTags(
  offices = [],
  stateCode = null,
  electionDate = null,
  countryCode = null,
  cityCode = null,
  alternateLabels = []
) {
  return offices
    .map((office) =>
      renderOfficeTag(office, stateCode, electionDate, countryCode, cityCode, alternateLabels)
    )
    .join("");
}

function resolveOfficeLabel(label, labelMapper = labelToOffice) {
  return labelMapper(label) ?? label;
}

function getOfficeColumns(states, officeOrder, labelMapper = labelToOffice) {
  return officeOrder.filter((office) =>
    states.some((state) =>
      (state.offices || []).some(
        (label) => resolveOfficeLabel(label, labelMapper) === office
      )
    )
  );
}

function getPrimaryOfficeColumns(states) {
  return getOfficeColumns(states, OFFICE_ORDER);
}

function getMidtermOfficeColumns(states) {
  return getOfficeColumns(states, MIDTERM_OFFICE_ORDER);
}

function renderAlignedOfficeCells(
  offices,
  columns,
  stateCode,
  electionDate,
  countryCode = null,
  cityCode = null,
  labelMapper = labelToOffice,
  alternateLabels = []
) {
  const labelsByOffice = new Map();
  const extraLabels = [];

  for (const label of offices || []) {
    const office = resolveOfficeLabel(label, labelMapper);
    if (office && columns.includes(office)) {
      labelsByOffice.set(office, label);
    } else if (label) {
      extraLabels.push(label);
    }
  }

  const cells = columns
    .map((office) => {
      const label = labelsByOffice.get(office);
      const content = label
        ? renderOfficeTag(label, stateCode, electionDate, countryCode, cityCode, alternateLabels)
        : "";
      return `<div class="state-office-cell">${content}</div>`;
    })
    .join("");

  const extras = extraLabels.length
    ? `<div class="state-offices-extra">${extraLabels
        .map((label) => renderOfficeTag(label, stateCode, electionDate, countryCode, cityCode, alternateLabels))
        .join("")}</div>`
    : "";

  return cells + extras;
}

function renderLabelTags(
  labels = [],
  stateCode = null,
  electionDate = null,
  countryCode = null,
  cityCode = null,
  alternateLabels = []
) {
  if (!labels.length) return "";

  return `<div class="card-labels">${labels
    .map((label) =>
      tagNeedsInteractivity(label, stateCode, countryCode, cityCode, electionDate, alternateLabels)
        ? renderInteractiveOfficeTag(
            label,
            stateCode,
            electionDate,
            countryCode,
            cityCode,
            alternateLabels
          )
        : `<span class="office-tag">${label}</span>`
    )
    .join("")}</div>`;
}

function renderStateName(state, countryCode) {
  const showFlag =
    (countryCode === "US" || countryCode === "DE") && state.code;

  if (!showFlag) {
    return `<span class="state-name">${state.name}</span>`;
  }

  return `
    <span class="state-name">
      <img class="state-flag" src="${stateFlagUrl(countryCode, state.code)}" alt="${stateFlagAlt(state.name)}" width="22" height="15" loading="lazy" />
      ${state.name}
    </span>`;
}

function renderSections(election) {
  const sections = visibleSections(election);
  if (!sections.length) return "";

  const nationalAlternates = nationalElectionLabelCandidates(election);
  const showSectionLabels =
    hasMixedLevelSections(sections) && election.title !== "Midterms";

  return `<div class="card-sections">${sections
    .map((section) => {
      const sectionLabel = showSectionLabels
        ? `<div class="section-label">${section.label}</div>`
        : "";

      if (section.states?.length) {
        const isMidterms = election.title === "Midterms";
        const officeColumns = election.isPrimaryDay
          ? getPrimaryOfficeColumns(section.states)
          : isMidterms
            ? getMidtermOfficeColumns(section.states)
            : [];
        const useAlignedOffices = officeColumns.length > 0;
        const listStyle = useAlignedOffices
          ? ` style="--office-cols: ${officeColumns.length}"`
          : "";

        return `
          <div class="election-section">
            ${sectionLabel}
            <div class="state-list${useAlignedOffices ? " state-list--aligned" : ""}"${listStyle}>
              ${section.states
                .map((state) => {
                  const rowClass = useAlignedOffices ? "state-row state-row--aligned" : "state-row";
                  const officesHtml = useAlignedOffices
                    ? renderAlignedOfficeCells(
                        state.offices,
                        officeColumns,
                        state.code,
                        election.date,
                        election.country_code,
                        null,
                        labelToOffice,
                        nationalAlternates
                      )
                    : renderOfficeTags(
                        state.offices,
                        state.code,
                        election.date,
                        election.country_code,
                        null,
                        nationalAlternates
                      );
                  const officesWrapper = useAlignedOffices
                    ? officesHtml
                    : `<div class="state-offices">${officesHtml}</div>`;

                  return `
                <div class="${rowClass}">
                  ${renderStateName(state, election.country_code)}
                  ${officesWrapper}
                </div>`;
                })
                .join("")}
            </div>
          </div>`;
      }

      return `
        <div class="election-section">
          ${sectionLabel}
          <div class="section-offices">${renderOfficeTags(section.offices, null, election.date, election.country_code, null, nationalAlternates)}</div>
        </div>`;
    })
    .join("")}</div>`;
}

function renderCard(election) {
  const { day, weekday, full, isEstimated } = formatCardDate(election);
  const { title, labels, sections, showMeta, offices } = resolveCardDisplay(election);
  const nationalAlternates = nationalElectionLabelCandidates(election);
  const officeTags = showMeta
    ? renderOfficeTags(
        offices,
        null,
        election.date,
        election.country_code,
        election.city_code,
        nationalAlternates
      )
    : "";

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
        </div>
        ${renderLabelTags(
          labels,
          election.state_code,
          election.date,
          election.country_code,
          election.city_code,
          nationalAlternates
        )}
        ${sections.length ? renderSections(election) : showMeta ? `<div class="card-meta">${officeTags}</div>` : ""}
        ${electionCommentLabel(election.comment) ? `<p class="card-comment">${electionCommentLabel(election.comment)}</p>` : ""}
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
