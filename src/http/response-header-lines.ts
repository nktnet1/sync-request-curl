import { validateHeaderName, validateHeaderValue } from "node:http";
import { RetryableRequestError } from "#/errors";

const invalidResponseHeaders = (message: string, cause?: unknown): never => {
  throw new RetryableRequestError(
    "ERR_REQUEST_FAILED",
    `Request failed: Invalid response headers: ${message}`,
    cause === undefined ? undefined : { cause },
  );
};

const trimOptionalWhitespace = (value: string): string => {
  let begin = 0;
  while (value.charAt(begin) === " " || value.charAt(begin) === "\t") {
    begin += 1;
  }

  let end = value.length;
  while (
    end > begin &&
    (value.charAt(end - 1) === " " || value.charAt(end - 1) === "\t")
  ) {
    end -= 1;
  }

  return value.slice(begin, end);
};

interface ParsedResponseHeaderLine {
  name: string;
  value: string;
}

export const parseResponseHeaderLine = (
  header: string,
): ParsedResponseHeaderLine => {
  const separatorIndex = header.indexOf(":");
  if (separatorIndex <= 0) {
    invalidResponseHeaders("malformed header line");
  }

  const rawName = header.slice(0, separatorIndex);
  const rawValue = header.slice(separatorIndex + 1);

  try {
    validateHeaderName(rawName);
  } catch (error) {
    invalidResponseHeaders("invalid header name", error);
  }

  try {
    validateHeaderValue(rawName, rawValue);
  } catch (error) {
    invalidResponseHeaders(`invalid value for ${rawName}`, error);
  }

  return {
    name: rawName.toLowerCase(),
    value: trimOptionalWhitespace(rawValue),
  };
};

export const unfoldResponseHeaderLines = (headerLines: string[]): string[] => {
  const unfoldedLines: string[] = [];

  for (const line of headerLines) {
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      unfoldedLines.push(line);
      continue;
    }

    // libcurl 8.18+ unfolds obs-fold before the header callback. Older
    // versions expose continuation lines, so normalise them here as well.
    const previousLine = unfoldedLines.pop();
    if (previousLine === undefined || previousLine === "") {
      invalidResponseHeaders("malformed header line");
    }

    unfoldedLines.push(`${previousLine} ${trimOptionalWhitespace(line)}`);
  }

  return unfoldedLines;
};
