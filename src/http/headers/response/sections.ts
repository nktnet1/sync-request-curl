import {
  getHttpStatusCode,
  isHttpStatusLine,
} from "#/http/headers/response/status";

// libcurl can internally retry authentication challenges and report both the
// challenge and final response through the same header callback.
const redirectStatusCodes = new Set([301, 302, 303, 307, 308]);
const authenticationChallengeStatusCodes = new Set([401, 407]);

interface ResponseHeaderSections {
  blocks: string[][];
  detachedLines: string[];
}

const splitHeaderLinesWithoutStatus = (
  headerLines: string[],
): ResponseHeaderSections => {
  const headerEndIndex = headerLines.indexOf("");
  return {
    blocks: [
      headerEndIndex >= 0
        ? headerLines.slice(0, headerEndIndex)
        : headerLines.slice(),
    ],
    detachedLines:
      headerEndIndex >= 0 ? headerLines.slice(headerEndIndex + 1) : [],
  };
};

const canStartResponseHeaderBlock = (
  statusCode: number | undefined,
  allowAnotherResponseBlock: boolean,
  current: ResponseHeaderReader["current"],
): statusCode is number =>
  statusCode !== undefined &&
  allowAnotherResponseBlock &&
  current === undefined;

const canFollowResponseHeaderBlock = (
  statusCode: number,
  hasRequestBoundaries: boolean,
): boolean => {
  if (statusCode >= 100 && statusCode < 200) return true;
  const isRetry =
    redirectStatusCodes.has(statusCode) ||
    authenticationChallengeStatusCodes.has(statusCode);
  return !hasRequestBoundaries && isRetry;
};

interface ResponseHeaderReader extends ResponseHeaderSections {
  current: { headers: string[]; statusCode: number } | undefined;
  allowAnotherResponseBlock: boolean;
}

const readResponseHeaderLine = (
  state: ResponseHeaderReader,
  line: string,
  index: number,
  requestStarts: Set<number>,
  hasRequestBoundaries: boolean,
): void => {
  const statusCode = getHttpStatusCode(line);
  const allowNewBlock =
    state.allowAnotherResponseBlock || requestStarts.has(index);
  if (canStartResponseHeaderBlock(statusCode, allowNewBlock, state.current)) {
    state.current = { headers: [], statusCode };
    return;
  }

  if (line === "") {
    if (state.current === undefined) return;
    state.blocks.push(state.current.headers);
    state.allowAnotherResponseBlock = canFollowResponseHeaderBlock(
      state.current.statusCode,
      hasRequestBoundaries,
    );
    state.current = undefined;
    return;
  }

  if (state.current === undefined) {
    state.detachedLines.push(line);
  } else {
    state.current.headers.push(line);
  }
};

export const splitResponseHeaderSections = (
  headerLines: string[],
  requestHeaderOffsets: readonly number[] | undefined,
): ResponseHeaderSections => {
  if (!headerLines.some(isHttpStatusLine)) {
    return splitHeaderLinesWithoutStatus(headerLines);
  }

  const state: ResponseHeaderReader = {
    blocks: [],
    detachedLines: [],
    current: undefined,
    allowAnotherResponseBlock: true,
  };
  // Only native HEADER_OUT events can authorize a new exchange after a final
  // response. Legacy native results without metadata use status-based guesses.
  const requestStarts = new Set(requestHeaderOffsets);
  for (const [index, line] of headerLines.entries()) {
    readResponseHeaderLine(
      state,
      line,
      index,
      requestStarts,
      requestHeaderOffsets !== undefined,
    );
  }
  if (state.current !== undefined) {
    state.blocks.push(state.current.headers);
  }
  return { blocks: state.blocks, detachedLines: state.detachedLines };
};
