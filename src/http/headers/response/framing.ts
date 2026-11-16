import { RetryableRequestError } from "#/errors";
import {
  getFinalResponseHeaderLines,
  isAsciiDigit,
} from "#/http/headers/response/status";

export const invalidResponseFraming = (message: string): never => {
  throw new RetryableRequestError(
    "ERR_REQUEST_FAILED",
    `Request failed: Invalid response framing: ${message}`,
  );
};

const normalizeContentLengthValue = (value: string): string => {
  if (value.length === 0) {
    invalidResponseFraming("invalid Content-Length");
  }

  for (const character of value) {
    if (!isAsciiDigit(character)) {
      invalidResponseFraming("invalid Content-Length");
    }
  }

  const normalized = value.replace(/^0+(?=\d)/, "");
  return normalized;
};

export const validateAndNormalizeContentLength = (
  values: string[],
): string | undefined => {
  if (values.length === 0) {
    return undefined;
  }

  if (values.length !== 1 || values[0].includes(",")) {
    invalidResponseFraming("multiple Content-Length values are not allowed");
  }

  normalizeContentLengthValue(values[0]);
  return values[0];
};

export const throwForResponseFramingTransportError = (
  transportCode: number,
  transportMessage: string,
  headerLines: string[],
): void => {
  if (
    transportCode !== 8 ||
    !transportMessage.includes("Invalid Content-Length")
  ) {
    return;
  }

  const finalHeaderLines = getFinalResponseHeaderLines(headerLines);
  const capturedContentLength = finalHeaderLines.some((header) => {
    const separatorIndex = header.indexOf(":");
    return (
      separatorIndex > 0 &&
      header.slice(0, separatorIndex).trim().toLowerCase() === "content-length"
    );
  });

  invalidResponseFraming(
    capturedContentLength
      ? "multiple Content-Length values are not allowed"
      : "invalid Content-Length",
  );
};
