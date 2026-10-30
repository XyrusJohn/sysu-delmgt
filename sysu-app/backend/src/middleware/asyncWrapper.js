/**
 * asyncWrapper
 * Wraps async route handlers to automatically catch errors and pass them to the errorHandler middleware.
 * Eliminates the need for repetitive try-catch blocks in controllers.
 */
const asyncWrapper = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { asyncWrapper };
