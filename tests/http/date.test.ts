import { afterEach, expect, test, vi } from "vitest";
import { parseHttpDate } from "#/http/date";

const reference = Date.UTC(2026, 9, 5);
afterEach(() => vi.unstubAllEnvs());

test.each([
  "Sun, 06 Nov 1994 08:49:37 GMT",
  "Sunday, 06-Nov-94 08:49:37 GMT",
  "Sun Nov  6 08:49:37 1994",
  "sun, 06 nov 1994 08:49:37 gmt",
  "sunday, 06-nov-94 08:49:37 gmt",
  "sun nov  6 08:49:37 1994",
  "  Sun, 06 Nov 1994 08:49:37 GMT\t",
])("accepts HTTP-date formats independently of local time: %s", (value) => {
  vi.stubEnv("TZ", "Australia/Sydney");
  expect(parseHttpDate(value, reference)).toBe(
    Date.UTC(1994, 10, 6, 8, 49, 37),
  );
});

test.each([
  {
    value: "Sun Nov 16 08:49:37 1994",
    expected: Date.UTC(1994, 10, 16, 8, 49, 37),
  },
  { value: "Thu, 29 Feb 2024 00:00:00 GMT", expected: Date.UTC(2024, 1, 29) },
  {
    value: "Thursday, 29-Feb-00 00:00:00 GMT",
    expected: Date.UTC(2000, 1, 29),
  },
  { value: "Fri, 31 Dec 1999 23:59:60 GMT", expected: Date.UTC(2000, 0, 1) },
  { value: "Thu, 01 Jan 0099 00:00:00 GMT", expected: -59_042_995_200_000 },
])("preserves valid calendar values: $value", ({ value, expected }) => {
  expect(parseHttpDate(value, reference)).toBe(expected);
});

test.each([
  { value: "Sunday, 05-Oct-76 00:00:00 GMT", expected: Date.UTC(2076, 9, 5) },
  {
    value: "Sunday, 05-Oct-76 00:00:01 GMT",
    expected: Date.UTC(1976, 9, 5, 0, 0, 1),
  },
  { value: "Thursday, 01-Jan-50 00:00:00 GMT", expected: Date.UTC(2050, 0, 1) },
  { value: "Thursday, 01-Jan-14 00:00:00 GMT", expected: Date.UTC(2014, 0, 1) },
])(
  "resolves two-digit years against the 50-year cutoff: $value",
  ({ value, expected }) => {
    expect(parseHttpDate(value, reference)).toBe(expected);
  },
);

test("two-digit years work across a century boundary", () => {
  expect(
    parseHttpDate("Thursday, 01-Jan-14 00:00:00 GMT", Date.UTC(2068, 0, 1)),
  ).toBe(Date.UTC(2114, 0, 1));
});

test.each([
  undefined,
  "",
  "0",
  "9999",
  "3600",
  "not-a-date",
  "2026-10-05T00:00:00Z",
  "Mon, 05 Oct 2026 00:00:00 UTC",
  "Mon, 05 Oct 2026 00:00:00 +0000",
  "Mon, 05 Oct 2026 00:00:00 PST",
  "Xxx, 05 Oct 2026 00:00:00 GMT",
  "Mon, 05 Foo 2026 00:00:00 GMT",
  "Monday, 05-Foo-26 00:00:00 GMT",
  "Mon Foo  5 00:00:00 2026",
  "Mon, 05 Oct 2026 00:00:00 GMT trailing",
  "Mon, 05 Oct 2026 00:00:00 GMT, Tue, 06 Oct 2026 00:00:00 GMT",
  "Mon, 00 Oct 2026 00:00:00 GMT",
  "Mon, 32 Oct 2026 00:00:00 GMT",
  "Mon, 31 Apr 2026 00:00:00 GMT",
  "Mon, 29 Feb 2026 00:00:00 GMT",
  "Mon, 05 Oct 2026 24:00:00 GMT",
  "Mon, 05 Oct 2026 00:60:00 GMT",
  "Mon, 05 Oct 2026 00:00:61 GMT",
  "Monday, 29-Feb-26 00:00:00 GMT",
  "Mon Feb 29 00:00:00 2026",
])("rejects non-HTTP and invalid dates: %s", (value) => {
  expect(parseHttpDate(value, reference)).toBeUndefined();
});
