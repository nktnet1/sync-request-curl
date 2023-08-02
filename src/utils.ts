import { IncomingHttpHeaders } from 'http';

export const handleQs = (url: string, qs: { [key: string]: any }): string => {
  const urlObj = new URL(url);
  const queryParams = urlObj.searchParams;

  Object.entries(qs).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      queryParams.delete(key);
      value.forEach((item) => queryParams.append(key, item.toString()));
    } else {
      queryParams.set(key, value.toString());
    }
  });

  urlObj.search = queryParams.toString();

  return urlObj.href;
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
