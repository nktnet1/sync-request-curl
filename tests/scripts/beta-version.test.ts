import { expect, test } from "vitest";
import { nextBetaVersion } from "#scripts/beta-version";

test.each([
  ["5.0.0", [], [], undefined, "5.0.0-beta.1"],
  ["5.0.0-beta.3", [], [], undefined, "5.0.0-beta.4"],
  [
    "5.0.0",
    ["5.0.0-beta.9", "5.1.0-beta.99"],
    ["v5.0.0-beta.12"],
    undefined,
    "5.0.0-beta.13",
  ],
  [
    "5.0.0",
    [],
    ["v5.0.0-beta.9007199254740992"],
    undefined,
    "5.0.0-beta.9007199254740993",
  ],
  ["5.0.0", ["5.0.0"], [], "5.0.1", "5.0.1-beta.1"],
  [
    "5.0.0",
    ["5.0.0", "5.1.0-beta.2"],
    ["v5.1.0-beta.4"],
    "v5.1.0",
    "5.1.0-beta.5",
  ],
])(
  "selects the next beta from %s with base %s",
  (current, published, tags, requestedBase, expected) => {
    expect(nextBetaVersion(current, published, tags, requestedBase)).toBe(
      expected,
    );
  },
);

test.each(["4.0.0", "6.0.0", "5.0.0-rc.1", "05.0.0", "5.0.0-beta.01"])(
  "rejects unsupported current version %s",
  (current) => {
    expect(() => nextBetaVersion(current, [], [])).toThrow();
  },
);

test.each(["4.1.0", "6.0.0", "5.1.0-beta.1", "v5.1.0-beta.1", "v5"])(
  "rejects unsupported requested base %s",
  (requestedBase) => {
    expect(() => nextBetaVersion("5.0.0", [], [], requestedBase)).toThrow();
  },
);

test("requires an explicit base after the manifest stable version is released", () => {
  expect(() => nextBetaVersion("5.0.0", ["5.0.0"], [])).toThrow(
    "choose the next v5 base explicitly with --base <version>",
  );
});

test("rejects a requested base whose stable version is already published", () => {
  expect(() =>
    nextBetaVersion("5.0.0", ["5.0.0", "5.1.0"], [], "5.1.0"),
  ).toThrow("5.1.0 is already released");
});
