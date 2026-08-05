import { AppError } from '../utils/app-error.js';

export const validateBody = (schema, statusCode = 422) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return next(new AppError('Validation failed', statusCode, errors));
  }
  req.body = result.data;
  next();
};
