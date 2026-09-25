import { gunzipSync, inflateSync } from "node:zlib";
import { RequestError } from "#/errors";
import type { Response } from "#/types";

const getContentEncodings = (headers: Response["headers"]): string[] => {
  const contentEncoding = headers["content-encoding"];
  if (contentEncoding === undefined) {
    return [];
  }

  const values = Array.isArray(contentEncoding)
    ? contentEncoding
    : [contentEncoding];

  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0 && value !== "identity");
};

const isSupportedContentEncoding = (encoding: string): boolean =>
  encoding === "gzip" || encoding === "x-gzip" || encoding === "deflate";

const decodeBody = (body: Buffer, encodings: string[]): Buffer => {
  let decoded = body;

  for (const encoding of [...encodings].reverse()) {
    decoded =
      encoding === "deflate" ? inflateSync(decoded) : gunzipSync(decoded);
  }

  return decoded;
};

export const decompressResponseBody = (
  body: Buffer,
  headers: Response["headers"],
  enabled: boolean,
): Buffer => {
  if (!enabled || body.length === 0) {
    return body;
  }

  const encodings = getContentEncodings(headers);
  if (
    encodings.length === 0 ||
    encodings.some((encoding) => !isSupportedContentEncoding(encoding))
  ) {
    return body;
  }

  try {
    const decoded = decodeBody(body, encodings);
    delete headers["content-encoding"];
    return decoded;
  } catch (cause) {
    throw new RequestError(
      "ERR_REQUEST_FAILED",
      `Request failed: Unable to decompress ${encodings.join(", ")} response`,
      { cause },
    );
  }
};
