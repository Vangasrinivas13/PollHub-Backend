const { body, param, query, validationResult } = require('express-validator');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// User validation rules
const validateUserRegistration = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),
  handleValidationErrors
];

const validateUserLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
];

// Poll validation rules
const validatePollCreation = [
  body('title')
    .trim()
    .isLength({ min: 5, max: 100 })
    .withMessage('Title must be between 5 and 100 characters'),
  body('description')
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('Description must be between 10 and 500 characters'),
  body('options')
    .isArray({ min: 2, max: 10 })
    .withMessage('Poll must have between 2 and 10 options'),
  body('options.*.text')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Each option must be between 1 and 200 characters'),
  body('startDate')
    .isISO8601()
    .withMessage('Start date must be a valid date'),
  body('endDate')
    .isISO8601()
    .withMessage('End date must be a valid date')
    .custom((endDate, { req }) => {
      if (new Date(endDate) <= new Date(req.body.startDate)) {
        throw new Error('End date must be after start date');
      }
      return true;
    }),
  body('category')
    .optional()
    .isIn(['general', 'political', 'entertainment', 'sports', 'technology', 'education', 'business', 'other'])
    .withMessage('Invalid category'),
  handleValidationErrors
];

const validatePollUpdate = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 5, max: 100 })
    .withMessage('Title must be between 5 and 100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('Description must be between 10 and 500 characters'),
  body('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid date'),
  body('status')
    .optional()
    .isIn(['draft', 'active', 'inactive', 'completed', 'cancelled'])
    .withMessage('Invalid status'),
  handleValidationErrors
];

// Vote validation rules
const validateVote = [
  body('optionIndex')
    .isInt({ min: 0 })
    .withMessage('Option index must be a non-negative integer'),
  param('pollId')
    .isMongoId()
    .withMessage('Invalid poll ID'),
  handleValidationErrors
];

// Parameter validation
const validateMongoId = (paramName) => [
  param(paramName)
    .isMongoId()
    .withMessage(`Invalid ${paramName}`),
  handleValidationErrors
];

// Query validation
const validatePagination = [
  query('page')
    .optional({ checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional({ checkFalsy: true })
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors
];

const validatePollFilters = [
  query('status')
    .optional({ checkFalsy: true })
    .isIn(['draft', 'active', 'inactive', 'completed', 'cancelled'])
    .withMessage('Invalid status filter'),
  query('category')
    .optional({ checkFalsy: true })
    .isIn(['general', 'political', 'entertainment', 'sports', 'technology', 'education', 'business', 'other'])
    .withMessage('Invalid category filter'),
  query('sortBy')
    .optional({ checkFalsy: true })
    .isIn(['createdAt', 'updatedAt', 'title', 'totalVotes', 'endDate'])
    .withMessage('Invalid sort field'),
  query('sortOrder')
    .optional({ checkFalsy: true })
    .isIn(['asc', 'desc'])
    .withMessage('Sort order must be asc or desc'),
  query('search')
    .optional({ checkFalsy: true })
    .isString()
    .withMessage('Search must be a string'),
  handleValidationErrors
];

module.exports = {
  validateUserRegistration,
  validateUserLogin,
  validatePollCreation,
  validatePollUpdate,
  validateVote,
  validateMongoId,
  validatePagination,
  validatePollFilters,
  handleValidationErrors
};
