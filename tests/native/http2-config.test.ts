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
  test("bundled libcurl enables HTTP/2, HTTP/3, static TLS, and Apple SecTrust", () => {
    const features = section("features");

    expect(features).toContain(
      'bundled-curl = ["curl-sys/http2", "curl-sys/http3", "curl-sys/ssl", "curl-sys/static-curl", "curl-sys/static-ssl", "curl-sys/apple-sectrust"]',
    );
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
