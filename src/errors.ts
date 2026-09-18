export class CurlError extends Error {
  // https://curl.se/libcurl/c/libcurl-errors.html
  code: number;
  constructor(code: number, message: string) {
    super(message);
    if (code < 1 || code > 101) {
      throw new Error(`
        CurlError code must be between 1 and 101. Given: ${code}.

        Please take a look at the resource below for valid Libcurl errors:
          - https://curl.se/libcurl/c/libcurl-errors.html
      `);
    }
    this.code = code;
    Object.setPrototypeOf(this, CurlError.prototype);
  }
}
