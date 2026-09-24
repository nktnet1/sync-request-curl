import type { NativeCurlOptions } from "#/native";
import type {
  CurlOption,
  CurlOptionInput,
  CurlOptionValue,
  Easy,
} from "#/types";

export const curlOption = {
  HTTPHEADER: 1,
  PROXY: 2,
  PROXYUSERPWD: 3,
  USERAGENT: 4,
  REFERER: 5,
  CAINFO: 6,
  INTERFACE: 7,
  DNS_SERVERS: 8,
  TCP_KEEPALIVE: 9,
} as const satisfies CurlOption;

export interface EasyOptionsSnapshot {
  headers: string[];
  curlOptions: NativeCurlOptions;
}

function stringValue(option: CurlOptionValue, value: CurlOptionInput): string {
  if (typeof value !== "string") {
    const name = Object.entries(curlOption).find(
      ([, id]) => id === option,
    )?.[0];
    throw new TypeError(`${name ?? option} must be a string`);
  }
  return value;
}

export class EasyOptions implements Easy {
  #isOpen = true;
  #headers: string[];
  readonly #curlOptions: NativeCurlOptions = {};

  constructor(headers: string[]) {
    this.#headers = [...headers];
  }

  get isOpen(): boolean {
    return this.#isOpen;
  }

  setOpt(option: CurlOptionValue, value: CurlOptionInput): void {
    if (!this.#isOpen) {
      throw new Error("Cannot set an option on a closed cURL handle");
    }

    switch (option) {
      case curlOption.HTTPHEADER:
        if (
          !Array.isArray(value) ||
          !value.every((item) => typeof item === "string")
        ) {
          throw new TypeError("HTTPHEADER must be an array of strings");
        }
        this.#headers = [...value];
        return;
      case curlOption.PROXY:
        this.#curlOptions.proxy = stringValue(option, value);
        return;
      case curlOption.PROXYUSERPWD:
        this.#curlOptions.proxyUserPwd = stringValue(option, value);
        return;
      case curlOption.USERAGENT:
        this.#curlOptions.userAgent = stringValue(option, value);
        return;
      case curlOption.REFERER:
        this.#curlOptions.referer = stringValue(option, value);
        return;
      case curlOption.CAINFO:
        this.#curlOptions.caInfo = stringValue(option, value);
        return;
      case curlOption.INTERFACE:
        this.#curlOptions.interface = stringValue(option, value);
        return;
      case curlOption.DNS_SERVERS:
        this.#curlOptions.dnsServers = stringValue(option, value);
        return;
      case curlOption.TCP_KEEPALIVE:
        if (typeof value !== "boolean" && typeof value !== "number") {
          throw new TypeError("TCP_KEEPALIVE must be a boolean or number");
        }
        this.#curlOptions.tcpKeepAlive = Boolean(value);
        return;
      default: {
        const exhaustive: never = option;
        throw new Error(`Unsupported cURL option: ${String(exhaustive)}`);
      }
    }
  }

  snapshot(): EasyOptionsSnapshot {
    if (!this.#isOpen) {
      throw new Error("Cannot read options from a closed cURL handle");
    }
    return {
      headers: [...this.#headers],
      curlOptions: { ...this.#curlOptions },
    };
  }

  close(): void {
    this.#isOpen = false;
  }
}

export const CurlCode = {
  CURLE_OK: 0,
  CURLE_OPERATION_TIMEDOUT: 28,
  CURLE_TOO_MANY_REDIRECTS: 47,
} as const;
