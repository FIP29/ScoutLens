// Small helpers shared by every route module.

/** Wraps an async route so a rejected promise reaches Express's error handler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** An error carrying an HTTP status code. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Parses a positive integer query parameter, or returns null when absent. */
export function optionalInt(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new ApiError(400, `${field} must be a non-negative integer`);
  }
  return n;
}

/** Parses a required positive integer route parameter. */
export function requiredInt(value, field) {
  const n = optionalInt(value, field);
  if (n === null) throw new ApiError(400, `${field} is required`);
  return n;
}
