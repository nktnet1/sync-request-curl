export const digestFields = (authorization: string): Record<string, string> => {
  const fields: Record<string, string> = Object.create(null);
  if (!authorization.startsWith("Digest ")) {
    return fields;
  }
  // Parse names and values separately to keep both patterns small. Sticky
  // matching never skips malformed input. The value alternatives are disjoint,
  // as are the quoted-string escape cases, so long invalid inputs stay linear.
  const parameterName = /[ \t]*([\w-]+)[ \t]*=[ \t]*/y;
  const parameterValue =
    /(?:"((?:[^"\\\r\n]|\\[^\r\n])*)"|([^",\s]+))[ \t]*(?:,|$)/y;
  let offset = "Digest ".length;
  while (offset < authorization.length) {
    parameterName.lastIndex = offset;
    const name = parameterName.exec(authorization);
    if (!name) {
      return {};
    }
    const key = name[1].toLowerCase();
    if (Object.hasOwn(fields, key)) {
      return {};
    }
    parameterValue.lastIndex = parameterName.lastIndex;
    const value = parameterValue.exec(authorization);
    if (!value) {
      return {};
    }
    fields[key] =
      value[1] === undefined
        ? value[2]
        : value[1].replace(/\\([^\r\n])/g, "$1");
    offset = parameterValue.lastIndex;
  }
  return fields;
};
