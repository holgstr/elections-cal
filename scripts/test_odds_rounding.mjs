import { roundExclusiveOdds } from "../js/odds-change.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

const mo01 = roundExclusiveOdds([50.5, 50.5]);
assert(sum(mo01) === 100, `MO-01 display odds must sum to 100, got ${mo01}`);
assert(mo01[0] === 50 && mo01[1] === 50, `MO-01 expected [50, 50], got ${mo01}`);

const threeWay = roundExclusiveOdds([33.33, 33.33, 33.34]);
assert(sum(threeWay) === 100, `three-way display odds must sum to 100, got ${threeWay}`);

const under = roundExclusiveOdds([90, 8]);
assert(sum(under) === 98, `filtered longshots may sum under 100, got ${under}`);

const party = roundExclusiveOdds([92.5, 8.5]);
assert(sum(party) === 100, `party display odds must sum to 100, got ${party}`);

const advance = roundExclusiveOdds([95.35, 75.5, 67, 39, 36.5]);
assert(sum(advance) > 100, "multi-advance markets may sum above 100");
assert(
  JSON.stringify(advance) === JSON.stringify([95, 76, 67, 39, 37]),
  `advance rounding mismatch: ${advance}`
);

console.log("test_odds_rounding: ok");
