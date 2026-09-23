import type { NativeCurlOptions } from "./native";
import type { CurlOption, CurlOptionInput, CurlOptionValue, Easy } from "./types";

export const curlOption = {
  HTTPHEADER: "HTTPHEADER",
  PROXY: "PROXY",
  PROXYUSERPWD: "PROXYUSERPWD",
  USERAGENT: "USERAGENT",
  REFERER: "REFERER",
  CAINFO: "CAINFO",
  INTERFACE: "INTERFACE",
  DNS_SERVERS: "DNS_SERVERS",
  TCP_KEEPALIVE: "TCP_KEEPALIVE",
} as const satisfies CurlOption;

export interface EasyOptionsSnapshot {
  headers: string[];
  curlOptions: NativeCurlOptions;
}

export class EasyOptions implements Easy {
  #isOpen = true;
  #headers: string[];
  #curlOptions: NativeCurlOptions = {};

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
        this.#curlOptions.proxy = this.#stringValue(option, value);
        return;
      case curlOption.PROXYUSERPWD:
        this.#curlOptions.proxyUserPwd = this.#stringValue(option, value);
        return;
      case curlOption.USERAGENT:
        this.#curlOptions.userAgent = this.#stringValue(option, value);
        return;
      case curlOption.REFERER:
        this.#curlOptions.referer = this.#stringValue(option, value);
        return;
      case curlOption.CAINFO:
        this.#curlOptions.caInfo = this.#stringValue(option, value);
        return;
      case curlOption.INTERFACE:
        this.#curlOptions.interface = this.#stringValue(option, value);
        return;
      case curlOption.DNS_SERVERS:
        this.#curlOptions.dnsServers = this.#stringValue(option, value);
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

  #stringValue(option: CurlOptionValue, value: CurlOptionInput): string {
    if (typeof value !== "string") {
      throw new TypeError(`${option} must be a string`);
    }
    return value;
  }
}

export const CurlCode = {
  CURLE_OK: 0,
  CURLE_OPERATION_TIMEDOUT: 28,
  CURLE_TOO_MANY_REDIRECTS: 47,
} as const;
