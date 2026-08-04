import { fitLinearModel, fitPlateauModel } from "../js/trends.js";

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

assert(fitPlateauModel(null) === null, "plateau null points");
assert(fitPlateauModel([]) === null, "plateau empty points");
assert(fitPlateauModel([{ x: 1, y: 2 }]) === null, "plateau single point");

// Rising through x=2 then flat at y=5 for x>=2: y = 1 + 2·min(x, 2)
const plateauPerfect = fitPlateauModel([
  { x: 0, y: 1 },
  { x: 1, y: 3 },
  { x: 2, y: 5 },
  { x: 3, y: 5 },
  { x: 4, y: 5 },
]);
assert(plateauPerfect, "perfect plateau fit");
assertClose(plateauPerfect.slope, 2, 1e-9, "plateau rising slope");
assertClose(plateauPerfect.intercept, 1, 1e-9, "plateau intercept");
assertClose(plateauPerfect.breakpoint, 2, 1e-9, "plateau breakpoint");
assertClose(plateauPerfect.r2, 1, 1e-9, "plateau R²");
assertClose(plateauPerfect.predict(1.5), 4, 1e-9, "plateau predict below break");
assertClose(plateauPerfect.predict(10), 5, 1e-9, "plateau predict above break");

// Pure line should still fit (breakpoint lands at max x).
const plateauAsLine = fitPlateauModel([
  { x: 0, y: 1 },
  { x: 1, y: 3 },
  { x: 2, y: 5 },
]);
assert(plateauAsLine, "plateau on pure line");
assertClose(plateauAsLine.r2, 1, 1e-9, "plateau-as-line R²");
assertClose(plateauAsLine.predict(2), 5, 1e-9, "plateau-as-line predict");

const plateauSkipsBad = fitPlateauModel([
  { x: Number.NaN, y: 99 },
  { x: 0, y: 1 },
  { x: 1, y: 3 },
  { x: 2, y: 5 },
  { x: 4, y: null },
  { x: 3, y: 5 },
  { x: 4, y: 5 },
]);
assert(plateauSkipsBad, "plateau ignores non-finite");
assert(plateauSkipsBad.n === 5, "plateau finite-only n");
assertClose(plateauSkipsBad.breakpoint, 2, 1e-9, "plateau skip-bad breakpoint");
assertClose(plateauSkipsBad.r2, 1, 1e-9, "plateau skip-bad R²");

console.log("test_trends_lm_fit: ok");
