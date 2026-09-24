import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { run } from "#scripts/process";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    libc: { type: "string" },
    "glibc-max": { type: "string" },
  },
});

if (process.platform !== "linux") {
  throw new Error(
    "Native dependency verification currently runs on Linux builds only",
  );
}
if (!values.file || !existsSync(values.file)) {
  throw new Error("--file must point to a built native addon");
}
if (values.libc !== "gnu" && values.libc !== "musl") {
  throw new Error("--libc must be either gnu or musl");
}

const dynamicSection = run("readelf", ["-d", values.file], { capture: true });
const dependencies = Array.from(
  dynamicSection.matchAll(/\(NEEDED\).*Shared library: \[([^\]]+)\]/g),
  (match) => match[1],
);
const forbiddenPrefixes = [
  "libbrotli",
  "libcrypto",
  "libcurl",
  "libgcc_s",
  "libidn",
  "libnghttp2",
  "libpsl",
  "libssh",
  "libssl",
  "libstdc++",
  "libz.",
  "libzstd",
];
const unexpected = dependencies.filter((dependency) =>
  forbiddenPrefixes.some((prefix) => dependency.startsWith(prefix)),
);
if (unexpected.length > 0) {
  throw new Error(
    `Native addon still dynamically links bundled dependencies: ${unexpected.join(", ")}`,
  );
}

const parseVersion = (value: string): [number, number] => {
  const [major, minor] = value.split(".").map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    throw new TypeError(`Invalid glibc version: ${value}`);
  }
  return [major, minor];
};

const isNewer = (left: [number, number], right: [number, number]): boolean =>
  left[0] > right[0] || (left[0] === right[0] && left[1] > right[1]);

if (values.libc === "gnu" && values["glibc-max"]) {
  const maximum = parseVersion(values["glibc-max"]);
  const versionInfo = run("readelf", ["--version-info", values.file], {
    capture: true,
  });
  const requiredVersions = Array.from(
    versionInfo.matchAll(/GLIBC_(\d+\.\d+)/g),
    (match) => parseVersion(match[1]),
  );
  const tooNew = requiredVersions.find((version) => isNewer(version, maximum));
  if (tooNew) {
    throw new Error(
      `Native addon requires GLIBC_${tooNew.join(".")}, newer than the supported ` +
        `GLIBC_${maximum.join(".")} baseline`,
    );
  }
}

console.log(
  `Verified native dependencies for ${values.file}: ${dependencies.join(", ") || "none"}`,
);
