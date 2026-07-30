/**
 * Input validation helpers and express middleware functions.
 */

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str.trim();
}

const ALLOWED_PAYMENT_MODES = ['CASH', 'GPAY', 'UPI', 'CARD'];
const MAX_STRING_LENGTH = 255;

/**
 * Validate Login Request
 */
function validateLogin(req, res, next) {
  const { username, password } = req.body || {};

  const cleanUsername = sanitizeString(username);
  const cleanPassword = typeof password === 'string' ? password : '';

  if (!cleanUsername || !cleanPassword) {
    return res.status(400).json({
      success: false,
      message: 'Username and password are required.',
      errorCode: 'INVALID_INPUT',
      timestamp: new Date().toISOString()
    });
  }

  if (cleanUsername.length > MAX_STRING_LENGTH) {
    return res.status(400).json({
      success: false,
      message: 'Username exceeds maximum length.',
      errorCode: 'INVALID_INPUT',
      timestamp: new Date().toISOString()
    });
  }

  req.body.username = cleanUsername;
  req.body.password = cleanPassword;
  next();
}

/**
 * Validate Initial Setup Request
 */
function validateSetup(req, res, next) {
  const { username, password, fullName, phone } = req.body || {};

  const cleanUsername = sanitizeString(username);
  const cleanPassword = typeof password === 'string' ? password : '';
  const cleanFullName = sanitizeString(fullName);
  const cleanPhone = sanitizeString(phone);

  if (!cleanUsername || !cleanPassword || !cleanFullName) {
    return res.status(400).json({
      success: false,
      message: 'Username, password, and Full Name are required for initial setup.',
      errorCode: 'INVALID_INPUT',
      timestamp: new Date().toISOString()
    });
  }

  if (cleanPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters long.',
      errorCode: 'WEAK_PASSWORD',
      timestamp: new Date().toISOString()
    });
  }

  req.body.username = cleanUsername;
  req.body.password = cleanPassword;
  req.body.fullName = cleanFullName;
  req.body.phone = cleanPhone;
  next();
}

/**
 * Validate Parking Entry Request
 */
function validateParkingEntry(req, res, next) {
  const { vehNo, tokenNo, barcode, vehType, custName, mobileNo, rate, paymentMode, inDate, entryTime } = req.body || {};

  const cleanVehNo = sanitizeString(vehNo).toUpperCase();

  if (!cleanVehNo) {
    return res.status(400).json({
      success: false,
      message: 'Vehicle Number is required.',
      errorCode: 'INVALID_INPUT',
      timestamp: new Date().toISOString()
    });
  }

  if (cleanVehNo.length < 2 || cleanVehNo.length > 20) {
    return res.status(400).json({
      success: false,
      message: 'Invalid Vehicle Number length (must be 2-20 characters).',
      errorCode: 'INVALID_INPUT',
      timestamp: new Date().toISOString()
    });
  }

  if (custName && custName.length > 100) {
    return res.status(400).json({
      success: false,
      message: 'Customer Name cannot exceed 100 characters.',
      errorCode: 'INVALID_INPUT',
      timestamp: new Date().toISOString()
    });
  }

  // Indian mobile number validation: 10 digits starting with 6-9
  if (mobileNo && sanitizeString(mobileNo) !== '') {
    const cleanMobile = sanitizeString(mobileNo);
    if (!/^[6-9]\d{9}$/.test(cleanMobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number. Must be 10 digits starting with 6-9.',
        errorCode: 'INVALID_INPUT',
        timestamp: new Date().toISOString()
      });
    }
  }

  // Barcode length validation
  if (barcode && sanitizeString(barcode).length > 100) {
    return res.status(400).json({
      success: false,
      message: 'Barcode value exceeds maximum length (100 characters).',
      errorCode: 'INVALID_INPUT',
      timestamp: new Date().toISOString()
    });
  }

  const cleanPaymentMode = (sanitizeString(paymentMode) || 'CASH').toUpperCase();
  if (!ALLOWED_PAYMENT_MODES.includes(cleanPaymentMode)) {
    return res.status(400).json({
      success: false,
      message: `Invalid Payment Mode '${cleanPaymentMode}'. Allowed modes: ${ALLOWED_PAYMENT_MODES.join(', ')}`,
      errorCode: 'INVALID_PAYMENT_MODE',
      timestamp: new Date().toISOString()
    });
  }

  const parsedRate = rate !== undefined && rate !== null ? parseFloat(rate) : 15;
  if (isNaN(parsedRate) || parsedRate < 0) {
    return res.status(400).json({
      success: false,
      message: 'Parking rate cannot be negative.',
      errorCode: 'INVALID_INPUT',
      timestamp: new Date().toISOString()
    });
  }

  // Reject future entry timestamps
  if (inDate && entryTime) {
    try {
      const dateParts = inDate.trim().split(/[\/\-]/);
      if (dateParts.length === 3) {
        let day, month, year;
        if (dateParts[0].length === 4) {
          [year, month, day] = dateParts.map(Number);
        } else {
          [day, month, year] = dateParts.map(Number);
        }
        const entryDate = new Date(year, (month || 1) - 1, day || 1);
        if (entryDate.getTime() > Date.now() + 86400000) { // allow 1 day tolerance
          return res.status(400).json({
            success: false,
            message: 'Entry date cannot be in the future.',
            errorCode: 'INVALID_INPUT',
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (e) { /* non-critical parse failure, allow through */ }
  }

  req.body.vehNo = cleanVehNo;
  req.body.custName = sanitizeString(custName).substring(0, 100).toUpperCase();
  req.body.mobileNo = sanitizeString(mobileNo);
  req.body.vehType = sanitizeString(vehType).substring(0, 50) || 'BIKE 15';
  req.body.paymentMode = cleanPaymentMode;
  req.body.barcode = sanitizeString(barcode).substring(0, 100);
  req.body.rate = parsedRate;

  next();
}

/**
 * Validate Parking Checkout Request
 */
function validateCheckout(req, res, next) {
  const { tokenNo, barcode, paymentMode, fineAmount, txnRef } = req.body || {};

  if ((tokenNo === undefined || tokenNo === null || tokenNo === '') && !barcode) {
    return res.status(400).json({
      success: false,
      message: 'Token Number or Barcode is required for exit checkout.',
      errorCode: 'INVALID_INPUT',
      timestamp: new Date().toISOString()
    });
  }

  if (paymentMode) {
    const cleanPaymentMode = sanitizeString(paymentMode).toUpperCase();
    if (!ALLOWED_PAYMENT_MODES.includes(cleanPaymentMode)) {
      return res.status(400).json({
        success: false,
        message: `Invalid Payment Mode '${cleanPaymentMode}'. Allowed modes: ${ALLOWED_PAYMENT_MODES.join(', ')}`,
        errorCode: 'INVALID_PAYMENT_MODE',
        timestamp: new Date().toISOString()
      });
    }

    const ref = sanitizeString(txnRef || req.body.paymentRef || req.body.cardRef);

    // CASH: Transaction reference must NOT be provided
    if (cleanPaymentMode === 'CASH' && ref !== '') {
      return res.status(400).json({
        success: false,
        message: 'Transaction reference is prohibited for CASH payments.',
        errorCode: 'TRANSACTION_REF_PROHIBITED_FOR_CASH',
        timestamp: new Date().toISOString()
      });
    }

    // GPAY, UPI, CARD: Transaction reference is MANDATORY
    if (['GPAY', 'UPI', 'CARD'].includes(cleanPaymentMode)) {
      if (!ref || ref.length === 0) {
        return res.status(400).json({
          success: false,
          message: `Transaction reference is mandatory for ${cleanPaymentMode} payments.`,
          errorCode: 'MISSING_PAYMENT_REF',
          timestamp: new Date().toISOString()
        });
      }
      if (ref.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'Transaction reference exceeds maximum length (50 characters).',
          errorCode: 'INVALID_INPUT',
          timestamp: new Date().toISOString()
        });
      }
      req.body.paymentRef = ref;
    }

    req.body.paymentMode = cleanPaymentMode;
  }

  if (fineAmount !== undefined && fineAmount !== null) {
    const parsedFine = parseFloat(fineAmount);
    if (isNaN(parsedFine) || parsedFine < 0) {
      return res.status(400).json({
        success: false,
        message: 'Fine amount cannot be negative.',
        errorCode: 'INVALID_INPUT',
        timestamp: new Date().toISOString()
      });
    }
    req.body.fineAmount = parsedFine;
  }

  next();
}

/**
 * Helper to validate date range query parameters (dateFrom, dateTo).
 */
function validateDateRange(dateFromStr, dateToStr) {
  if (dateFromStr && dateToStr) {
    const d1 = new Date(dateFromStr);
    const d2 = new Date(dateToStr);
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      throw new Error('Invalid date format provided for date range filter.');
    }
    if (d1 > d2) {
      throw new Error('dateFrom cannot be later than dateTo.');
    }
  }
}

module.exports = {
  validateLogin,
  validateSetup,
  validateParkingEntry,
  validateCheckout,
  validateDateRange
};
