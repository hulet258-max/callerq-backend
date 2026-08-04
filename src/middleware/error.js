import { Prisma } from '@prisma/client';
import { AppError } from '../utils/app-error.js';

export const notFound = (req, _res, next) => next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));

export function errorHandler(error, _req, res, _next) {
  let status = error.statusCode || 500;
  let message = error.message || 'Internal server error';
  let errors = error.errors || [];

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      status = 409;
      message = 'A record with this value already exists';
      errors = [{ fields: error.meta?.target || [] }];
    } else if (error.code === 'P2025') {
      status = 404;
      message = 'Record not found';
    } else if (error.code === 'P2003') {
      status = 409;
      message = 'This record is still referenced by another record';
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    status = 422;
    message = 'Invalid request data';
  }

  if (status >= 500) console.error(error);
  res.status(status).json({ success: false, message, errors });
}
