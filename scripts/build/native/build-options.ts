export type CurlSource = "bundled" | "system";

type CliOptions = {
  curlSource?: CurlSource;
  help: boolean;
};

export const usage = `Usage: sync-request-curl-build [--libcurl=system|bundled]

Build the installed sync-request-curl addon from its bundled Rust sources.
Requires the Rust toolchain pinned by rust-toolchain.toml and platform native build tools.
Run using the same Node.js architecture as your application.
Set CARGO_BUILD_TARGET to override the Rust target.

Options:
  --libcurl=system    Link against a system-provided libcurl and fail if unavailable.
  --libcurl=bundled   Build the libcurl bundled by curl-sys.

Default: bundled libcurl with HTTP/3 on all release targets. Use --libcurl=system to opt into a system-provided libcurl.`;

const parseLibcurlArgument = (
  args: readonly string[],
  index: number,
): { curlSource: CurlSource; nextIndex: number } => {
  const argument = args[index];
  let value: string | undefined;
  let nextIndex = index;
  if (argument === "--libcurl") {
    value = args[index + 1];
    nextIndex += 1;
  } else if (argument?.startsWith("--libcurl=")) {
    value = argument.slice("--libcurl=".length);
  } else {
    throw new Error(`Unknown argument: ${argument}. Use --help for usage.`);
  }
  if (value !== "system" && value !== "bundled") {
    throw new Error(
      `Invalid --libcurl value: ${value ?? "(missing)"}. Expected system or bundled.`,
    );
  }
  return { curlSource: value, nextIndex };
};

export const parseCliOptions = (args: readonly string[]): CliOptions => {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { help: true };
  }

  let curlSource: CurlSource | undefined;
  let index = 0;
  while (index < args.length) {
    const parsed = parseLibcurlArgument(args, index);
    if (curlSource !== undefined) {
      throw new Error("--libcurl may only be specified once.");
    }
    curlSource = parsed.curlSource;
    index = parsed.nextIndex + 1;
  }
  return { curlSource, help: false };
};
