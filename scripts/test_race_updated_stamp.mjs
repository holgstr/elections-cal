import {
  raceUpdatedAt,
  formatRaceUpdatedStamp,
} from "../js/trends.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(raceUpdatedAt(null) === null, "null race has no stamp");
assert(raceUpdatedAt({}) === null, "empty race has no stamp");
assert(
  raceUpdatedAt({ fetched_at: "2026-07-28T14:42:05Z" }) ===
    "2026-07-28T14:42:05Z",
  "prefers fetched_at"
);
assert(
  raceUpdatedAt({
    stale: { reason: "fetch_failed", data_as_of: "2026-07-27T22:29:45Z" },
  }) === "2026-07-27T22:29:45Z",
  "falls back to stale data_as_of"
);
assert(
  raceUpdatedAt({
    fetched_at: "2026-07-28T14:42:05Z",
    stale: { reason: "fetch_failed", data_as_of: "2026-07-27T22:29:45Z" },
  }) === "2026-07-28T14:42:05Z",
  "fetched_at wins over stale"
);

assert(formatRaceUpdatedStamp("") === "", "empty stamp");
assert(formatRaceUpdatedStamp("not-a-date") === "", "invalid stamp");
assert(
  formatRaceUpdatedStamp("2026-07-28") === "Jul 28 UTC",
  `date-only stamp, got ${formatRaceUpdatedStamp("2026-07-28")}`
);
assert(
  formatRaceUpdatedStamp("2026-07-28T14:42:05Z") === "Jul 28, 2:42 PM UTC",
  `datetime stamp, got ${formatRaceUpdatedStamp("2026-07-28T14:42:05Z")}`
);
assert(
  formatRaceUpdatedStamp("2026-07-27T22:29:45Z") === "Jul 27, 10:29 PM UTC",
  `evening stamp, got ${formatRaceUpdatedStamp("2026-07-27T22:29:45Z")}`
);

console.log("test_race_updated_stamp: ok");
