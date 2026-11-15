export const decodeQueryComponent = (value: string): string => {
  const normalized = value.replaceAll("+", " ");
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
};

const textEncoder = new TextEncoder();

const UNRESERVED =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

const isUnreservedByte = (byte: number): boolean =>
  UNRESERVED.includes(String.fromCodePoint(byte));

export const encodeQueryComponent = (value: string): string => {
  let encoded = "";
  for (const byte of textEncoder.encode(value)) {
    encoded += isUnreservedByte(byte)
      ? String.fromCodePoint(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return encoded;
};
