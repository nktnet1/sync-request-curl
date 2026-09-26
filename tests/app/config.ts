import * as v from "valibot";

const portSchema = v.pipe(
  v.string(),
  v.regex(/^\d+$/, "PORT must be an integer"),
  v.transform(Number),
  v.number(),
  v.integer(),
  v.minValue(1),
  v.maxValue(65_535),
);

export const PORT = v.parse(portSchema, process.env.PORT ?? "49152");
export const FRAMING_PORT = v.parse(
  portSchema,
  process.env.FRAMING_PORT ?? String(PORT === 65_535 ? PORT - 1 : PORT + 1),
);
export const HOST = v.parse(v.string(), process.env.IP ?? "127.0.0.1");
export const SERVER_URL = `http://${HOST}:${PORT}`;
export const FRAMING_SERVER_URL = `http://${HOST}:${FRAMING_PORT}`;
