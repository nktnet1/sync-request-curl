const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const imfDate =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([a-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/i;
const rfc850Date =
  /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-([a-z]{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/i;
const asctimeDate =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([a-z]{3}) ([ \d]\d) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/i;

const getFullYear = (value: string, referenceTime: number): number => {
  const year = Number(value);
  if (value.length !== 2) return year;
  const currentYear = new Date(referenceTime).getUTCFullYear();
  const candidate = currentYear - (currentYear % 100) + year;
  return candidate < currentYear ? candidate + 100 : candidate;
};

const toTimestamp = (
  parts: readonly string[],
  referenceTime: number,
): number | undefined => {
  const day = Number(parts[1]);
  const month = months.indexOf(parts[2].toLowerCase());
  const year = getFullYear(parts[3], referenceTime);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  if (month < 0 || hour > 23 || minute > 59 || second > 60) return undefined;
  const leapSecond = second === 60 ? 1_000 : 0;

  // setUTCFullYear avoids Date.UTC's special interpretation of years 00–99.
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, Math.min(second, 59), 0);
  if (parts[3].length === 2) {
    const cutoff = new Date(referenceTime);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() + 50);
    if (date.getTime() + leapSecond > cutoff.getTime())
      date.setUTCFullYear(year - 100, month, day);
  }
  if (date.getUTCDate() !== day) return undefined;
  return date.getTime() + leapSecond;
};

/** Parse the three HTTP-date formats in UTC, without JavaScript date guesses. */
export const parseHttpDate = (
  value: string | undefined,
  referenceTime: number,
): number | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  const standard = imfDate.exec(normalized) ?? rfc850Date.exec(normalized);
  if (standard) return toTimestamp(standard, referenceTime);
  const obsolete = asctimeDate.exec(normalized);
  if (!obsolete) return undefined;
  return toTimestamp(
    [
      "",
      obsolete[2],
      obsolete[1],
      obsolete[6],
      obsolete[3],
      obsolete[4],
      obsolete[5],
    ],
    referenceTime,
  );
};
