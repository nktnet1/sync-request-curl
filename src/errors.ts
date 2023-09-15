export class CurlError extends Error {
  // https://curl.se/libcurl/c/libcurl-errors.html
  code: number;
  constructor(code: number, message: string) {
    super(message);
    if (code < 1 || code > 99) {
      throw new Error(`CurlError code must be between 1 and 99. Given: ${code}`);
    }
    this.code = code;
    Object.setPrototypeOf(this, CurlError.prototype);
  }
}
