import { flagUrl, flagAlt } from "./flags.js";

const GROUP_LABELS = {
  all: "All",
  oecd: "OECD",
  brics: "BRICS",
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
  const groups = ["all", "oecd", "brics", "US", "DE"];
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

function filterElections() {
  return allElections.filter((election) => {
    if (hideStates && election.level === "state") return false;

    if (activeGroup !== "all") {
      if (activeGroup === "US" || activeGroup === "DE") {
        if (election.country_code !== activeGroup) return false;
      } else if (!election.groups?.includes(activeGroup)) {
        return false;
      }
    }

    if (searchQuery) {
      const haystack = [
        election.country,
        election.state,
        election.title,
        election.type,
        election.notes,
        ...(election.offices || []),
        LEVEL_LABELS[election.level],
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchQuery)) return false;
    }

    return true;
  });
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

function renderCard(election) {
  const { day, weekday, full, isEstimated } = formatCardDate(election);
  const location = election.state
    ? `${election.state}, ${election.country}`
    : election.country;
  const offices = (election.offices || [])
    .map((office) => `<span class="office-tag">${office}</span>`)
    .join("");

  return `
    <article class="card">
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
        <div class="card-meta">
          <span class="badge badge-level">${LEVEL_LABELS[election.level] || election.level}</span>
          ${offices}
        </div>
        ${election.notes ? `<p class="card-notes">${election.notes}</p>` : ""}
      </div>
      <time class="card-time" datetime="${election.date}">${full}</time>
    </article>
  `;
}

function renderHeader() {
  const filtered = filterElections();
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
  const filtered = filterElections();
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
