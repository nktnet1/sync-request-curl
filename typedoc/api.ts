// Keep the request function as a direct reflection so the TypeDoc plugins can
// preserve references from its parameters to the public HttpVerb/Options types.
// All other documented exports come from the actual ESM package root.

export * from "#/index-esm";
export { default as request } from "#/request/index";
