import { describe, expect, test } from "vitest";
import request from "#/index";
import { rate, rateEndpoint } from "./helpers";

describe("upload rate-limit allowance", () => {
  // Aligned payloads can leave only a tiny final chunk on some libcurl builds,
  // hiding premature allowance resets. Exercise substantial final bursts too.
  test.each([32 * 1024, 96 * 1024])(
    "preserves the final upload allowance for a %i-byte body",
    (uploadBytes) => {
      const response = request("POST", `${rateEndpoint}/upload`, {
        body: Buffer.alloc(uploadBytes, "x"),
        maxUploadSpeed: rate,
        socketTimeout: 200,
        overallTimeout: 5_000,
      });
      expect(response.getJSON()).toEqual({ bytes: uploadBytes });
    },
  );
});
