import { expect, test } from "vitest";
import { nextBetaVersion } from "#scripts/beta-version";

test.each([
  ["5.0.0", [], [], "5.0.0-beta.1"],
  ["5.0.0-beta.3", [], [], "5.0.0-beta.4"],
  [
    "5.0.0",
    ["5.0.0-beta.9", "5.1.0-beta.99"],
    ["v5.0.0-beta.12"],
    "5.0.0-beta.13",
  ],
  [
    "5.0.0",
    [],
    ["v5.0.0-beta.9007199254740992"],
    "5.0.0-beta.9007199254740993",
  ],
])("selects the next beta from %s", (current, published, tags, expected) => {
  expect(nextBetaVersion(current, published, tags)).toBe(expected);
});

test.each(["4.0.0", "6.0.0", "5.0.0-rc.1", "05.0.0", "5.0.0-beta.01"])(
  "rejects unsupported current version %s",
  (current) => {
    expect(() => nextBetaVersion(current, [], [])).toThrow();
  },
);

test("rejects betas for an already published stable version", () => {
  expect(() => nextBetaVersion("5.0.0-beta.2", ["5.0.0"], [])).toThrow(
    "already released",
  );
});
