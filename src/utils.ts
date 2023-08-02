import { IncomingHttpHeaders } from 'http';

export const generateQueryString = (qs: Record<string, string | number>): string => {
  return Object.entries(qs)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
};

export const parseHeaders = (headerLines: string[]): IncomingHttpHeaders => {
  return headerLines.reduce((acc, header) => {
    const [name, ...values] = header.split(':');
    if (name && values.length > 0) {
      acc[name.trim()] = values.join(':').trim();
    }
    return acc;
  }, {} as IncomingHttpHeaders);
};
