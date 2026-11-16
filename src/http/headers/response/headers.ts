import {
  invalidResponseFraming,
  validateAndNormalizeContentLength,
} from "#/http/headers/response/framing";
import {
  parseResponseHeaderLine,
  unfoldResponseHeaderLines,
} from "#/http/headers/response/header-lines";
import { appendResponseHeader } from "#/http/headers/response/header-values";
import { splitResponseHeaderSections } from "#/http/headers/response/sections";
import type { Response } from "#/types/definition";
import { parseSchema } from "#/validate";
import { incomingHttpHeadersSchema } from "#/validation";

const parseResponseHeaderBlock = (
  headerLines: string[],
): Response["headers"] => {
  const parsedHeaders = new Map<string, string | string[]>();
  const contentLengthValues: string[] = [];
  let hasTransferEncoding = false;

  for (const header of unfoldResponseHeaderLines(headerLines)) {
    const { name, value } = parseResponseHeaderLine(header);
    if (name === "content-length") {
      contentLengthValues.push(value);
      continue;
    }
    if (name === "transfer-encoding") {
      hasTransferEncoding = true;
    }
    appendResponseHeader(parsedHeaders, name, value);
  }

  const contentLength = validateAndNormalizeContentLength(contentLengthValues);
  if (contentLength !== undefined) {
    if (hasTransferEncoding) {
      invalidResponseFraming(
        "Content-Length cannot be combined with Transfer-Encoding",
      );
    }
    parsedHeaders.set("content-length", contentLength);
  }

  return parseSchema(
    incomingHttpHeadersSchema,
    Object.fromEntries(parsedHeaders),
  );
};

/**
 * Validates every response header block and trailer line, while exposing only
 * the final response header block like Node's IncomingMessage.
 */
export const parseResponseHeaders = (
  headerLines: string[],
  requestHeaderOffsets?: readonly number[],
): Response["headers"] => {
  const { blocks, detachedLines } = splitResponseHeaderSections(
    headerLines,
    requestHeaderOffsets,
  );
  let finalHeaders: Response["headers"] = {};

  for (const block of blocks) {
    finalHeaders = parseResponseHeaderBlock(block);
  }

  for (const line of unfoldResponseHeaderLines(detachedLines)) {
    if (line !== "") {
      parseResponseHeaderLine(line);
    }
  }

  return finalHeaders;
};
