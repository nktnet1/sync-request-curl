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

const file = values.file;
if (!file || !existsSync(file)) {
  throw new Error("--file must point to a built native addon");
}

const libc = values.libc;
if (libc !== "gnu" && libc !== "musl") {
  throw new Error("--libc must be either gnu or musl");
}

const dynamicSection = run("readelf", ["-d", file], { capture: true });
const dependencies = Array.from(
  dynamicSection.matchAll(/\(NEEDED\).*Shared library: \[([^\]]+)\]/g),
  (match) => match[1],
);
const forbiddenPrefixes = [
  "libbrotli",
  "libcrypto",
  "libcurl",
  // rustc may dynamically use libgcc_s for GNU/Linux unwinding. It is a
  // platform runtime, not one of the native dependencies bundled here.
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
  const [majorText, minorText] = value.split(".");
  const major = Number(majorText);
  const minor = Number(minorText);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    throw new TypeError(`Invalid glibc version: ${value}`);
  }
  return [major, minor];
};

const isNewer = (left: [number, number], right: [number, number]): boolean => {
  const [leftMajor, leftMinor] = left;
  const [rightMajor, rightMinor] = right;
  return (
    leftMajor > rightMajor ||
    (leftMajor === rightMajor && leftMinor > rightMinor)
  );
};

const maximumVersion = values["glibc-max"];
if (libc === "gnu" && maximumVersion) {
  const maximum = parseVersion(maximumVersion);
  const versionInfo = run("readelf", ["--version-info", file], {
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
  `Verified native dependencies for ${file}: ${dependencies.join(", ") || "none"}`,
);
