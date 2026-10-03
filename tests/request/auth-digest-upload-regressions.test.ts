import { describe, expect, test } from "vitest";
import { FormData } from "#/form-data";
import request from "#/index";
import { FRAMING_SERVER_URL } from "#tests/app/config";
import { credentials, expectHeaderDeadline } from "./auth-regressions.helpers";

describe("successful Digest upload probes", () => {
  const upload = `${FRAMING_SERVER_URL}/regressions/rate/upload`;
  const auth = { ...credentials, type: "digest" } as const;

  test.each(["POST", "PUT", "GET"] as const)(
    "returns only the real %s upload response after an accepted empty probe",
    (method) => {
      for (const timeout of [0, 1_000]) {
        const response = request(method, upload, {
          body: "abc",
          auth,
          timeout,
          overallTimeout: 2_000,
        });
        expect(response.statusCode).toBe(200);
        expect(response.getJSON()).toStrictEqual({ bytes: 3 });
        expect(response.headers["x-received-bytes"]).toBe("3");
      }
    },
  );

  test("preserves binary, JSON, and multipart payloads", () => {
    const form = new FormData();
    form.append("field", "value");
    for (const payload of [
      { body: Buffer.from([0, 1, 255]) },
      { json: { value: true } },
      { form },
    ]) {
      const response = request("POST", upload, {
        ...payload,
        auth,
        timeout: 1_000,
        overallTimeout: 2_000,
      });
      expect(response.statusCode).toBe(200);
      const bytes = Number(response.headers["x-received-bytes"]);
      expect(bytes).toBeGreaterThan(0);
      expect(response.getJSON()).toStrictEqual({ bytes });
    }
  });

  test("keeps the deadline while draining an accepted probe", () => {
    expectHeaderDeadline(`${upload}?initialBodyDelay=1500`, {
      body: "abc",
      auth,
    });
  });

  test("does not time out the real upload response body", () => {
    const response = request(
      "POST",
      `${upload}?initialBodyDelay=0&bodyDelay=450`,
      {
        body: "abc",
        auth,
        timeout: 250,
        overallTimeout: 2_000,
      },
    );
    expect(response.statusCode).toBe(200);
    expect(response.getJSON()).toStrictEqual({ bytes: 3 });
  });
});
