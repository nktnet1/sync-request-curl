import { expect, vi } from "vitest";
import request from "#/index";
import native from "#/native/index";
import type { HttpVerb, Options } from "#/types/definition";

export const wrapperRequest = (
  method: HttpVerb,
  url: string,
  option?: Options,
) => {
  const rawResponse = request(method, url, option);
  let json: unknown;

  try {
    json = JSON.parse(rawResponse.body.toString());
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : `Non-Error thrown while parsing JSON (${typeof error})`;
    json = {
      error: `Failed to parse JSON: ${message}`,
    };
  }

  return {
    rawResponse,
    json,
    code: rawResponse.statusCode,
  };
};

export const expectRejectedBeforeNativeIo = (
  action: () => unknown,
  expectedMessage?: string,
): void => {
  const nativeRequest = vi.spyOn(native, "request").mockImplementation(() => {
    throw new Error("Unexpected native I/O");
  });

  try {
    if (expectedMessage === undefined) {
      expect(action).toThrow();
    } else {
      expect(action).toThrow(expectedMessage);
    }
    expect(nativeRequest).not.toHaveBeenCalled();
  } finally {
    nativeRequest.mockRestore();
  }
};
