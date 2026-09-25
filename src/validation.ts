import type { IncomingHttpHeaders } from "node:http";
import { URL } from "node:url";
import * as v from "valibot";
import { FormData } from "#/form-data";
import type { Options } from "#/types";

const headerValueSchema = v.union([
  v.string(),
  v.array(v.string()),
  v.undefined(),
]);

export const incomingHttpHeadersSchema = v.custom<IncomingHttpHeaders>(
  (input) => v.is(v.record(v.string(), headerValueSchema), input),
  "Invalid HTTP headers",
);

export const optionsSchema = v.custom<Options>(
  (input) =>
    v.is(
      v.object({
        headers: v.optional(incomingHttpHeadersSchema),
        qs: v.optional(v.record(v.string(), v.unknown())),
        json: v.optional(v.unknown()),
        body: v.optional(v.union([v.string(), v.instance(Buffer)])),
        form: v.optional(v.instance(FormData)),
        timeout: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0))),
        followRedirects: v.optional(v.boolean()),
        maxRedirects: v.optional(v.number()),
        allowRedirectHeaders: v.optional(v.array(v.string())),
        gzip: v.optional(v.boolean()),
        debug: v.optional(v.boolean()),
      }),
      input,
    ),
  "Invalid request options",
);

export const uppercaseHttpVerbSchema = v.picklist([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "CONNECT",
  "OPTIONS",
  "TRACE",
  "PATCH",
]);

export const uppercaseHttpVerbs = uppercaseHttpVerbSchema.options;

export const httpVerbSchema = v.pipe(
  v.string(),
  v.transform((method) => method.toUpperCase()),
  uppercaseHttpVerbSchema,
);

export const requestUrlSchema = v.pipe(
  v.union([v.string(), v.instance(URL)]),
  v.transform((url) => (typeof url === "string" ? url : url.href)),
);
