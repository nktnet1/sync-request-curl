import { describe, expect, test } from "vitest";
import { parseCliOptions } from "#scripts/build/native/build-options";

describe("native build CLI options", () => {
  test("accepts --help and the default build options", () => {
    expect(parseCliOptions([])).toEqual({ curlSource: undefined, help: false });
    expect(parseCliOptions(["--help"])).toEqual({ help: true });
    expect(parseCliOptions(["-h"])).toEqual({ help: true });
  });

  test("accepts both inline and separate libcurl values", () => {
    expect(parseCliOptions(["--libcurl=system"])).toEqual({
      curlSource: "system",
      help: false,
    });
    expect(parseCliOptions(["--libcurl", "bundled"])).toEqual({
      curlSource: "bundled",
      help: false,
    });
  });

  test("does not process a separate libcurl value as another argument", () => {
    expect(() => parseCliOptions(["--libcurl", "system"])).not.toThrow();
    expect(() =>
      parseCliOptions(["--libcurl", "system", "--libcurl=bundled"]),
    ).toThrow("--libcurl may only be specified once.");
  });

  test("rejects invalid and missing option values", () => {
    expect(() => parseCliOptions(["--libcurl"])).toThrow(
      "Invalid --libcurl value",
    );
    expect(() => parseCliOptions(["--libcurl=nope"])).toThrow(
      "Invalid --libcurl value",
    );
    expect(() => parseCliOptions(["--other"])).toThrow("Unknown argument");
  });
});
