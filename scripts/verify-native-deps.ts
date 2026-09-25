import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import * as v from "valibot";
import { run } from "#scripts/process";

const argsSchema = v.object({
  file: v.string("--file must point to a built native addon"),
  libc: v.picklist(
    ["gnu", "musl"] as const,
    "--libc must be either gnu or musl",
  ),
  "glibc-max": v.optional(
    v.pipe(v.string(), v.regex(/^\d+\.\d+$/, "Invalid glibc version")),
  ),
});

const versionSchema = v.pipe(
  v.string(),
  v.regex(/^\d+\.\d+$/, "Invalid glibc version"),
  v.transform((value): [number, number] => {
    const [major, minor] = value.split(".");
    return [Number(major), Number(minor)];
  }),
  v.tuple([v.pipe(v.number(), v.integer()), v.pipe(v.number(), v.integer())]),
);

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

const args = v.parse(argsSchema, values);
if (!existsSync(args.file)) {
  throw new Error(`Native addon does not exist: ${args.file}`);
}

const dynamicSection = run("readelf", ["-d", args.file], { capture: true });
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

const parseVersion = (value: string): [number, number] =>
  v.parse(versionSchema, value);

const isNewer = (left: [number, number], right: [number, number]): boolean => {
  const [leftMajor, leftMinor] = left;
  const [rightMajor, rightMinor] = right;
  return (
    leftMajor > rightMajor ||
    (leftMajor === rightMajor && leftMinor > rightMinor)
  );
};

if (args.libc === "gnu" && args["glibc-max"]) {
  const maximum = parseVersion(args["glibc-max"]);
  const versionInfo = run("readelf", ["--version-info", args.file], {
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
  `Verified native dependencies for ${args.file}: ${dependencies.join(", ") || "none"}`,
);
