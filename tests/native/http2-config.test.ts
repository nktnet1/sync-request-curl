import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const cargoToml = readFileSync(
  new URL("../../native/Cargo.toml", import.meta.url),
  "utf8",
);

const dependencySection = (target: string): string => {
  const marker = `[target.'${target}'.dependencies]`;
  const start = cargoToml.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);

  const bodyStart = start + marker.length;
  const nextSection = cargoToml.indexOf("\n[", bodyStart);
  return cargoToml.slice(
    bodyStart,
    nextSection === -1 ? undefined : nextSection,
  );
};

describe("native HTTP/2 build contract", () => {
  test("bundled non-macOS libcurl enables HTTP/2", () => {
    const section = dependencySection('cfg(not(target_os = "macos"))');

    expect(section).toContain(
      'features = ["http2", "ssl", "static-curl", "static-ssl"]',
    );
  });

  test("macOS delegates protocol support to the system libcurl", () => {
    const section = dependencySection('cfg(target_os = "macos")');

    expect(section).toContain('features = ["force-system-lib-on-osx"]');
    expect(section).not.toContain('"http2"');
  });
});
