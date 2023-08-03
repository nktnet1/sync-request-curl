import { Request, Response, NextFunction } from 'express';

const errorHandler = () => (err: any, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err.status || err.statusCode || 500;
  console.log(statusCode === 500 ? err : err.message);
  res.status(statusCode).json({ error: err.message });
  return next();
};

export default errorHandler;
