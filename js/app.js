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
let meta = null;
let activeGroup = "all";
let searchQuery = "";
let hideStates = false;

async function init() {
  const [electionsRes, metaRes] = await Promise.all([
    fetch("data/elections.json"),
    fetch("data/meta.json"),
  ]);

  allElections = await electionsRes.json();
  meta = await metaRes.json();

  buildFilters();
  renderHeader();
  render();
  bindEvents();
}

function buildFilters() {
  const groups = ["all", "oecd", "brics", "major", "US", "DE"];
  document.getElementById("group-filters").innerHTML = groups
    .map(
      (group) =>
        `<button type="button" class="chip${group === "all" ? " active" : ""}" data-group="${group}">${GROUP_LABELS[group]}</button>`
    )
    .join("");
}

function bindEvents() {
  document.getElementById("search").addEventListener("input", (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    render();
  });

  document.getElementById("group-filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-group]");
    if (!btn) return;
    activeGroup = btn.dataset.group;
    document.querySelectorAll("[data-group]").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.group === activeGroup);
    });
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

function mergeKey(election) {
  return `${election.date}|${election.country_code}|${election.state_code || ""}`;
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
    const labels = sorted.map((e) => e.title);
    const notes = [...new Set(items.map((e) => e.notes).filter(Boolean))];

    return {
      ...base,
      title: base.state || base.country,
      offices,
      labels,
      date_precision: isEstimated ? "estimated" : base.date_precision,
      notes: notes.length ? notes.join(" · ") : undefined,
    };
  });
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
    day: isEstimated ? "~" : d.getDate(),
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

  return `<div class="card-sections">${sections
    .map((section) => {
      if (section.states?.length) {
        return `
          <div class="election-section">
            <div class="section-label">${section.label}</div>
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
          <div class="section-label">${section.label}</div>
          <div class="section-offices">${renderOfficeTags(section.offices)}</div>
        </div>`;
    })
    .join("")}</div>`;
}

function renderCard(election) {
  const { day, weekday, full, isEstimated } = formatCardDate(election);
  const location = election.state
    ? `${election.state}, ${election.country}`
    : election.country;
  const sections = renderSections(election);
  const offices = sections
    ? ""
    : renderOfficeTags(election.offices);
  const labels = (election.labels || [])
    .map((label) => `<span class="election-label">${label}</span>`)
    .join("");

  return `
    <article class="card${sections ? " card-combined" : ""}">
      <img class="card-flag" src="${flagUrl(election)}" alt="${flagAlt(election)}" width="24" height="16" loading="lazy" />
      <div class="card-date">
        <div class="card-day">${day}</div>
        <div class="card-weekday">${weekday}</div>
      </div>
      <div class="card-body">
        <div class="card-topline">
          <h3 class="card-title">${election.title}</h3>
          ${isEstimated ? '<span class="badge badge-estimated">Est.</span>' : ""}
        </div>
        <p class="card-location">${location}</p>
        ${labels ? `<div class="card-labels">${labels}</div>` : ""}
        ${sections || `<div class="card-meta"><span class="badge badge-level">${LEVEL_LABELS[election.level] || election.level}</span>${offices}</div>`}
        ${election.notes ? `<p class="card-notes">${election.notes}</p>` : ""}
      </div>
      <time class="card-time" datetime="${election.date}">${full}</time>
    </article>
  `;
}

function renderHeader() {
  const filtered = getDisplayElections();
  const exact = filtered.filter((e) => e.date_precision === "exact").length;
  const estimated = filtered.length - exact;
  const next = filtered[0];

  const rangeLabel = meta
    ? `${new Date(meta.window_start + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })} – ${new Date(meta.window_end + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
    : "Next 12 months";

  document.getElementById("window-label").textContent = rangeLabel;

  document.getElementById("stats").innerHTML = `
    <div class="stat">
      <div class="stat-value">${filtered.length}</div>
      <div class="stat-label">Elections</div>
    </div>
    <div class="stat">
      <div class="stat-value">${exact}</div>
      <div class="stat-label">Exact dates</div>
    </div>
    <div class="stat">
      <div class="stat-value">${estimated}</div>
      <div class="stat-label">Estimated</div>
    </div>
    ${
      next
        ? `<div class="stat stat-next">
      <div class="stat-value">${next.state || next.country}</div>
      <div class="stat-label">Next · ${new Date(next.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
    </div>`
        : ""
    }
  `;
}

function render() {
  const filtered = getDisplayElections();
  const timeline = document.getElementById("timeline");
  renderHeader();

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
