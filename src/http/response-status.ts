// Parse HTTP status lines without interpreting the following header fields.
export const isAsciiDigit = (character: string): boolean =>
  character >= "0" && character <= "9";

const hasValidHttpVersion = (header: string, versionEnd: number): boolean => {
  if (versionEnd < 6) return false;
  let hasDigit = false;
  for (let i = 5; i < versionEnd; i += 1) {
    const character = header.charAt(i);
    if (isAsciiDigit(character)) {
      hasDigit = true;
    } else if (character !== ".") {
      return false;
    }
  }
  return hasDigit;
};

const skipStatusWhitespace = (header: string, start: number): number => {
  let index = start;
  while ([" ", "\t"].includes(header.charAt(index))) index += 1;
  return index;
};

export const getHttpStatusCode = (header: string): number | undefined => {
  if (header.slice(0, 5).toUpperCase() !== "HTTP/") return undefined;
  const versionEnd = header.indexOf(" ", 5);
  if (!hasValidHttpVersion(header, versionEnd)) return undefined;

  const statusStart = skipStatusWhitespace(header, versionEnd + 1);
  const statusDigits = header.slice(statusStart, statusStart + 3);
  if (statusDigits.length !== 3 || ![...statusDigits].every(isAsciiDigit)) {
    return undefined;
  }
  const boundary = header.charAt(statusStart + 3);
  return ["", " ", "\t"].includes(boundary) ? Number(statusDigits) : undefined;
};

export const isHttpStatusLine = (header: string): boolean =>
  getHttpStatusCode(header) !== undefined;

const findFinalStatusLineIndex = (headerLines: string[]): number => {
  let finalStatusLineIndex = -1;

  for (const [index, headerLine] of headerLines.entries()) {
    if (isHttpStatusLine(headerLine)) {
      finalStatusLineIndex = index;
    }
  }

  return finalStatusLineIndex;
};

export const getFinalResponseHeaderLines = (
  headerLines: string[],
): string[] => {
  const finalStatusLineIndex = findFinalStatusLineIndex(headerLines);
  const finalBlock =
    finalStatusLineIndex >= 0
      ? headerLines.slice(finalStatusLineIndex + 1)
      : headerLines;
  const headerEndIndex = finalBlock.indexOf("");

  return headerEndIndex >= 0 ? finalBlock.slice(0, headerEndIndex) : finalBlock;
};
