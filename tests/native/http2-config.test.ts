import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const cargoToml = readFileSync(
  new URL("../../native/Cargo.toml", import.meta.url),
  "utf8",
);
const buildRs = readFileSync(
  new URL("../../native/build.rs", import.meta.url),
  "utf8",
);

const section = (name: string): string => {
  const marker = `[${name}]`;
  const start = cargoToml.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);

  const bodyStart = start + marker.length;
  const nextSection = cargoToml.indexOf("\n[", bodyStart);
  return cargoToml.slice(
    bodyStart,
    nextSection === -1 ? undefined : nextSection,
  );
};

describe("native libcurl build contract", () => {
  test("bundled libcurl separates the HTTP/3 extension from the portable baseline", () => {
    const features = section("features");

    expect(features).toContain('default = ["bundled-curl-http3"]');
    expect(features).toContain(
      'bundled-curl-base = ["curl-sys/http2", "curl-sys/static-curl", "curl-sys/apple-sectrust"]',
    );
    expect(features).toContain(
      'bundled-curl = ["bundled-curl-base", "curl-sys/ssl", "curl-sys/static-ssl"]',
    );
    expect(features).toContain(
      'bundled-curl-http3 = ["bundled-curl-base", "curl-sys/http3"]',
    );

    const http3Feature = features
      .split("\n")
      .find((line) => line.startsWith("bundled-curl-http3 ="));
    expect(http3Feature).not.toContain('"bundled-curl"');
    expect(http3Feature).not.toContain('"curl-sys/ssl"');
    expect(http3Feature).not.toContain('"curl-sys/static-ssl"');
  });

  test("system libcurl keeps macOS force-system support without enabling bundled HTTP features", () => {
    const features = section("features");
    const systemFeature = features
      .split("\n")
      .find((line) => line.startsWith("system-curl ="));

    expect(systemFeature).toContain('"curl-sys/force-system-lib-on-osx"');
    expect(systemFeature).not.toContain('"curl-sys/http2"');
    expect(systemFeature).not.toContain('"curl-sys/http3"');
  });

  test("pins the curl-sys release that provides the HTTP/3 feature", () => {
    const dependencies = section("dependencies");

    expect(dependencies).toContain(
      'curl-sys = { package = "nktnet-curl-sys", version = "=0.4.91-nktnet.2", default-features = false }',
    );
  });

  test("system mode rejects curl-sys bundled fallback", () => {
    expect(buildRs).toContain('env::var_os("DEP_CURL_STATIC")');
    expect(buildRs).toContain("system-curl was requested");
  });
});
