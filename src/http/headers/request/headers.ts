// Case-insensitive parsing of libcurl-bound request header lines.
const getRequestHeaderDelimiterIndex = (header: string): number => {
  const colonIndex = header.indexOf(":");
  const semicolonIndex = header.indexOf(";");
  if (colonIndex < 0 || (semicolonIndex >= 0 && semicolonIndex < colonIndex)) {
    return semicolonIndex;
  }
  return colonIndex;
};

const getHeaderName = (header: string): string => {
  const delimiterIndex = getRequestHeaderDelimiterIndex(header);
  const endIndex = delimiterIndex < 0 ? header.length : delimiterIndex;
  return header.slice(0, endIndex).trim().toLowerCase();
};

export interface ParsedRequestHeaderLine {
  name: string;
  value: string;
}

export const parseRequestHeaderLine = (
  header: string,
): ParsedRequestHeaderLine | undefined => {
  const delimiterIndex = getRequestHeaderDelimiterIndex(header);
  if (delimiterIndex <= 0) {
    return undefined;
  }

  return {
    name: header.slice(0, delimiterIndex).trim().toLowerCase(),
    value:
      header.charAt(delimiterIndex) === ";"
        ? ""
        : header.slice(delimiterIndex + 1).trim(),
  };
};

const removeRequestHeader = (headers: string[], name: string): void => {
  const normalizedName = name.toLowerCase();
  const retainedHeaders = headers.filter(
    (header) => getHeaderName(header) !== normalizedName,
  );
  headers.splice(0, headers.length, ...retainedHeaders);
};

export const hasRequestHeader = (headers: string[], name: string): boolean => {
  const normalizedName = name.toLowerCase();
  return headers.some((header) => getHeaderName(header) === normalizedName);
};

export const hasNonEmptyRequestHeader = (
  headers: string[],
  name: string,
): boolean => {
  const normalizedName = name.toLowerCase();
  return headers.some((header) => {
    const parsed = parseRequestHeaderLine(header);
    return parsed?.name === normalizedName && parsed.value.length > 0;
  });
};

export const setRequestHeader = (
  headers: string[],
  name: string,
  value: string | number,
): void => {
  removeRequestHeader(headers, name);
  headers.push(`${name}: ${value}`);
};
