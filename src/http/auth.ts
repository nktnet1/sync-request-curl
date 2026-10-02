/** Usernames can be interpolated into Digest headers; passwords are not. */
export const isSafeAuthUsername = (value: string): boolean => {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  return true;
};

/** RFC 6750 b64token: one or more token characters, then optional padding. */
export const isSafeBearerToken = (value: string): boolean => {
  const token = value.replace(/=+$/, "");
  // A negative character class also rejects a final LF, unlike a JS $ anchor.
  return token.length > 0 && !/[^A-Za-z0-9._~+/-]/.test(token);
};

export const usesNegotiatedAuth = (type: string | undefined): boolean =>
  type !== undefined && type !== "basic" && type !== "bearer";
