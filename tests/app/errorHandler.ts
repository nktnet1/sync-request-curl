import { Request, Response, NextFunction } from 'express';

/**
 * Express error handler middleware.
 * - https://expressjs.com/en/guide/error-handling.html
 */
const errorHandler = () => (err: any, _req: Request, res: Response, next: NextFunction) => {
  const statusCode = err.status ?? err.statusCode ?? 500;
  console.log(statusCode === 500 ? err : err.message);
  res.status(statusCode).json({ error: err.message });
  return next();
};

export default errorHandler;
