import { RetryableRequestError } from "#/errors";

// CURLE_WRITE_ERROR from libcurl.
const curlWriteErrorCode = 23;
const responseHeaderOverflowTransportMessage =
  "Response headers exceeded the configured size limit";

export const throwForResponseHeaderTransportError = (
  transportCode: number,
  transportMessage: string,
): void => {
  if (
    transportCode === curlWriteErrorCode &&
    transportMessage === responseHeaderOverflowTransportMessage
  ) {
    throw new RetryableRequestError(
      "ERR_REQUEST_FAILED",
      "Request failed: Parse Error: Header overflow",
    );
  }
};
