const hasAsciiControl = (value: string): boolean => {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code === undefined || code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
};

/** Usernames can be interpolated into Digest headers; reject ASCII controls. */
export const isSafeAuthUsername = (value: string): boolean =>
  !hasAsciiControl(value);

/** Native string credentials cannot contain NUL even for non-HTTP schemes. */
export const isSafeAuthPassword = (value: string): boolean =>
  !value.includes("\0");

const usesHttpCredentialRestrictions = (type: string | undefined): boolean =>
  type === undefined || type === "basic" || type === "digest" || type === "any";

export const hasSafeOpaqueCredentials = (
  username: string,
  password: string | undefined,
): boolean =>
  isSafeAuthUsername(username) && isSafeAuthPassword(password ?? "");

export const hasSafeAuthCredentials = (
  username: string,
  password: string | undefined,
  type: string | undefined,
): boolean => {
  if (!hasSafeOpaqueCredentials(username, password)) {
    return false;
  }
  if (!usesHttpCredentialRestrictions(type)) {
    return true;
  }
  return !username.includes(":") && !hasAsciiControl(password ?? "");
};

/** RFC 6750 b64token: one or more token characters, then optional padding. */
export const isSafeBearerToken = (value: string): boolean => {
  // Scan the padding once instead of retrying a suffix regex at every '='.
  let tokenEnd = value.length;
  while (tokenEnd > 0 && value[tokenEnd - 1] === "=") {
    tokenEnd -= 1;
  }
  // A negative character class also rejects a final LF, unlike a JS $ anchor.
  return tokenEnd > 0 && !/[^A-Za-z0-9._~+/-]/.test(value.slice(0, tokenEnd));
};

export const usesNegotiatedAuth = (type: string | undefined): boolean =>
  type !== undefined && type !== "basic" && type !== "bearer";
