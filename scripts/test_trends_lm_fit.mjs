import { fitLinearModel, fitRootModel } from "../js/trends.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertClose(actual, expected, tol, message) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

assert(fitLinearModel(null) === null, "null points");
assert(fitLinearModel([]) === null, "empty points");
assert(fitLinearModel([{ x: 1, y: 2 }]) === null, "single point");
assert(
  fitLinearModel([
    { x: 1, y: 1 },
    { x: 1, y: 2 },
  ]) === null,
  "zero x variance"
);

const perfect = fitLinearModel([
  { x: 0, y: 1 },
  { x: 1, y: 3 },
  { x: 2, y: 5 },
]);
assert(perfect, "perfect line returns a fit");
assertClose(perfect.slope, 2, 1e-9, "perfect slope");
assertClose(perfect.intercept, 1, 1e-9, "perfect intercept");
assertClose(perfect.r2, 1, 1e-9, "perfect R²");
assert(perfect.n === 3, "perfect n");
assertClose(perfect.predict(3), 7, 1e-9, "perfect predict");

const noisy = fitLinearModel([
  { x: 1, y: 2 },
  { x: 2, y: 4.1 },
  { x: 3, y: 5.9 },
  { x: 4, y: 8.2 },
]);
assert(noisy, "noisy fit returns a model");
assert(noisy.r2 > 0.98 && noisy.r2 <= 1, `noisy R² in range, got ${noisy.r2}`);
assertClose(noisy.slope, 2.03, 0.05, "noisy slope near 2");

const filtered = fitLinearModel([
  { x: 10, y: 20 },
  { x: Number.NaN, y: 5 },
  { x: 20, y: 40 },
  { x: 30, y: null },
  { x: 30, y: 60 },
]);
assert(filtered, "ignores non-finite rows");
assert(filtered.n === 3, "finite-only n");
assertClose(filtered.r2, 1, 1e-9, "filtered perfect R²");

const constantY = fitLinearModel([
  { x: 1, y: 5 },
  { x: 2, y: 5 },
  { x: 3, y: 5 },
]);
assert(constantY, "constant y still fits");
assertClose(constantY.slope, 0, 1e-9, "flat slope");
assertClose(constantY.r2, 1, 1e-9, "constant y R² treated as 1");

const rootPerfect = fitRootModel([
  { x: 0, y: 1 },
  { x: 4, y: 5 },
  { x: 9, y: 7 },
  { x: 16, y: 9 },
]);
assert(rootPerfect, "perfect root fit");
assertClose(rootPerfect.slope, 2, 1e-9, "root slope on √x");
assertClose(rootPerfect.intercept, 1, 1e-9, "root intercept");
assertClose(rootPerfect.r2, 1, 1e-9, "root R²");
assertClose(rootPerfect.predict(25), 11, 1e-9, "root predict at 25");

assert(
  fitRootModel([
    { x: -1, y: 1 },
    { x: -4, y: 2 },
  ]) === null,
  "negative x dropped for root"
);

const rootSkipsNeg = fitRootModel([
  { x: -9, y: 99 },
  { x: 1, y: 3 },
  { x: 4, y: 5 },
  { x: 9, y: 7 },
]);
assert(rootSkipsNeg, "root ignores negatives");
assert(rootSkipsNeg.n === 3, "root finite non-neg n");
assertClose(rootSkipsNeg.r2, 1, 1e-9, "root skip-neg R²");

console.log("test_trends_lm_fit: ok");
