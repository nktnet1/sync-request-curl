import { OutgoingHttpHeaders } from 'http';

// Helper function to generate query string from options.qs
export const generateQueryString = (qs: Record<string, string | number>): string => {
  return Object.entries(qs)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
};

// Helper function to parse headers from the response
export const parseHeaders = (headerLines: string[]): OutgoingHttpHeaders => {
  return headerLines.reduce((acc, header) => {
    const [name, value] = header.split(':');
    if (name && value) {
      acc[name.trim()] = value.trim();
    }
    return acc;
  }, {} as OutgoingHttpHeaders);
};
