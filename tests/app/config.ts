export const PORT: number = parseInt(process.env.PORT ?? '49152');
export const HOST: string = process.env.IP ?? '127.0.0.1';
export const DEBUG = process.env.DEBUG !== 'false';
export const SERVER_URL = `http://${HOST}:${PORT}`;
