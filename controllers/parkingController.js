const db = require('../db');
const env = require('../config/env');
const { logAudit } = require('../utils/logger');
const { sendResponse, buildPagination } = require('../utils/response');
const { sendExport } = require('../utils/export');
const { createBackup, listBackups, verifyBackup, restoreBackup } = require('../utils/backup');
const { runHistoryCleanup, runAuditCleanup } = require('../jobs/scheduler');
const { validateDateRange } = require('../middleware/validationMiddleware');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEntryRow(row) {
  if (!row) return row;
  return {
    ...row,
    token_no: row.token_no !== null && row.token_no !== undefined ? parseInt(row.token_no, 10) : row.token_no,
    rate: row.rate !== null && row.rate !== undefined ? parseFloat(row.rate) : 15,
    fine_amount: row.fine_amount !== null && row.fine_amount !== undefined ? parseFloat(row.fine_amount) : 0,
    total_amount: row.total_amount !== null && row.total_amount !== undefined ? parseFloat(row.total_amount) : 0,
  };
}

/**
 * Server-authoritative parking fee calculation.
 * Rule: ≤1hr = ₹15 | ≤24hr = ₹30 | >24hr = ₹30 + ₹30 per additional 24-hr block
 */
function computeParkingFee(inDateStr, entryTimeStr, createdAtStr) {
  try {
    let entryDate = null;
    if (inDateStr && entryTimeStr) {
      const dateParts = inDateStr.trim().split(/[\/\-]/);
      let day, month, year;
      if (dateParts.length === 3) {
        if (dateParts[0].length === 4) {
          [year, month, day] = dateParts.map(Number);
          month -= 1;
        } else {
          [day, month, year] = dateParts.map(Number);
          month -= 1;
        }
      }
      const timeMatch = entryTimeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
      if (year && month !== undefined && day && timeMatch) {
        let h = parseInt(timeMatch[1], 10);
        const m = parseInt(timeMatch[2], 10);
        const ampm = (timeMatch[3] || '').toUpperCase();
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        entryDate = new Date(year, month, day, h, m, 0);
      }
    }
    if ((!entryDate || isNaN(entryDate.getTime())) && createdAtStr) {
      entryDate = new Date(createdAtStr);
    }
    if (!entryDate || isNaN(entryDate.getTime())) return 15;

    const diffMs = Math.max(0, Date.now() - entryDate.getTime());
    const totalHours = diffMs / 3600000;

    if (totalHours <= 1) return 15;
    if (totalHours <= 24) return 30;
    return 30 + Math.ceil((totalHours - 24) / 24) * 30;
  } catch {
    return 15;
  }
}

// ─── 1. Next Token ────────────────────────────────────────────────────────────

async function getNextToken(req, res) {
  try {
    const seqRes = await db.query(`SELECT nextval('parking_token_seq') as next_token`);
    const nextToken = parseInt(seqRes.rows[0].next_token, 10);
    return sendResponse(res, 200, true, 'Next token retrieved.', { nextToken }, null, req);
  } catch (err) {
    return sendResponse(res, 500, false, err.message, {}, null, req);
  }
}

// ─── 2. Get Active Entries ────────────────────────────────────────────────────

async function getEntries(req, res) {
  try {
    const { barcode, tokenNo, search } = req.query;

    let sql = `SELECT * FROM parking_entries WHERE (status = 'ACTIVE' OR status IS NULL) AND deleted_at IS NULL`;
    const params = [];
    let i = 1;

    if (barcode) { sql += ` AND barcode = $${i++}`; params.push(barcode); }
    if (tokenNo) { sql += ` AND token_no = $${i++}`; params.push(parseInt(tokenNo, 10)); }
    if (search) {
      sql += ` AND (barcode ILIKE $${i} OR veh_no ILIKE $${i} OR cust_name ILIKE $${i} OR CAST(token_no AS TEXT) ILIKE $${i} OR mobile_no ILIKE $${i})`;
      params.push(`%${search}%`);
    }
    sql += ` ORDER BY id DESC`;

    const result = await db.query(sql, params);
    const entries = result.rows.map(formatEntryRow);
    return sendResponse(res, 200, true, 'Active entries retrieved.', { count: entries.length, entries }, null, req);
  } catch (err) {
    return sendResponse(res, 500, false, err.message, {}, null, req);
  }
}

// ─── 3. Create Entry ──────────────────────────────────────────────────────────

async function createEntry(req, res) {
  try {
    let { tokenNo, barcode, vehType, vehNo, custName, mobileNo, rate, paymentMode, inDate, entryTime } = req.body;
    const normalizedVehNo = vehNo.trim().toUpperCase();
    const createdBy = req.user ? req.user.id : null;

    // Duplicate active vehicle check
    const dupRes = await db.query(
      `SELECT id, token_no FROM parking_entries WHERE UPPER(veh_no) = $1 AND (status = 'ACTIVE' OR status IS NULL) AND deleted_at IS NULL LIMIT 1`,
      [normalizedVehNo]
    );
    if (dupRes.rows.length > 0) {
      return sendResponse(res, 409, false, 'Vehicle already parked.', {
        errorCode: 'DUPLICATE_ENTRY',
        existingTokenNo: dupRes.rows[0].token_no
      }, null, req);
    }

    // Sync token with barcode digits
    if (barcode) {
      const digits = barcode.replace(/\D/g, '');
      if (digits) tokenNo = parseInt(digits, 10);
    }

    let parsedToken = (tokenNo !== undefined && tokenNo !== null && tokenNo !== '') ? parseInt(tokenNo, 10) : null;
    if (!parsedToken || isNaN(parsedToken)) {
      const seqRes = await db.query(`SELECT nextval('parking_token_seq') as next_token`);
      parsedToken = parseInt(seqRes.rows[0].next_token, 10);
    }

    const now = new Date();
    const tz = env.OUTLET_TIMEZONE || 'Asia/Kolkata';
    const dateStr = inDate || now.toLocaleDateString('en-GB', { timeZone: tz });
    const timeStr = entryTime || now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
    const cardBarcode = barcode || `CARD-${parsedToken}`;

    const result = await db.query(`
      INSERT INTO parking_entries (token_no, barcode, veh_type, veh_no, cust_name, mobile_no, rate, payment_mode, in_date, entry_time, status, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE',$11) RETURNING id
    `, [
      parsedToken, cardBarcode, vehType || 'BIKE 15', normalizedVehNo,
      custName ? custName.toUpperCase() : '', mobileNo || '',
      parseFloat(rate) || 15, paymentMode || 'CASH', dateStr, timeStr, createdBy
    ]);

    await logAudit(req, 'VEHICLE_ENTRY', `Token #${parsedToken} (${normalizedVehNo})`);

    return sendResponse(res, 201, true, `Token #${parsedToken} saved and linked to Card Barcode [${cardBarcode}]!`, {
      id: result.rows[0].id, tokenNo: parsedToken, barcode: cardBarcode
    }, null, req);
  } catch (err) {
    if (err.code === '23505') {
      return sendResponse(res, 409, false, `Token No ${req.body.tokenNo} already exists!`, { errorCode: 'DUPLICATE_TOKEN' }, null, req);
    }
    return sendResponse(res, 500, false, err.message, {}, null, req);
  }
}

// ─── 4. Lookup Vehicle ────────────────────────────────────────────────────────

async function lookupVehicle(req, res) {
  try {
    const query = (req.query.query || '').trim().toUpperCase();
    if (!query) return sendResponse(res, 400, false, 'Query is required.', {}, null, req);

    const numericToken = query.replace(/\D/g, '');
    const numericVal = (numericToken && !isNaN(parseInt(numericToken, 10))) ? parseInt(numericToken, 10) : -1;
    const formattedBarcode = numericToken ? `CARD-${numericToken}` : query;

    const result = await db.query(`
      SELECT * FROM parking_entries
      WHERE (status = 'ACTIVE' OR status IS NULL) AND deleted_at IS NULL
        AND (barcode=$1 OR (token_no=$2 AND $2 <> -1) OR ($3!='' AND barcode=$3) OR veh_no ILIKE $4)
      ORDER BY id DESC LIMIT 1
    `, [query, numericVal, formattedBarcode, `%${query}%`]);

    const row = formatEntryRow(result.rows[0]);
    if (!row) {
      return sendResponse(res, 404, false, `No active vehicle found matching [${query}]`, { errorCode: 'VEHICLE_NOT_FOUND' }, null, req);
    }
    return sendResponse(res, 200, true, 'Vehicle found.', { entry: row }, null, req);
  } catch (err) {
    return sendResponse(res, 500, false, err.message, {}, null, req);
  }
}

// ─── 5. Checkout Vehicle (Transaction + Soft Delete) ─────────────────────────

async function checkoutVehicle(req, res) {
  const { tokenNo, barcode, paymentMode, fineAmount, txnRef, paymentRef, cardRef } = req.body;
  const ref = (paymentRef || txnRef || cardRef || '').trim();
  const numericToken = (tokenNo && !isNaN(parseInt(tokenNo, 10))) ? parseInt(tokenNo, 10) : -1;
  const searchBarcode = barcode || '';
  const createdBy = req.user ? req.user.id : null;

  try {
    const result = await db.transaction(async (client) => {
      // Lock the active entry row
      const findRes = await client.query(`
        SELECT * FROM parking_entries
        WHERE ((token_no=$1 AND $1 <> -1) OR (barcode!='' AND barcode=$2))
          AND (status='ACTIVE' OR status IS NULL) AND deleted_at IS NULL
        FOR UPDATE
      `, [numericToken, searchBarcode]);

      if (!findRes.rows[0]) {
        return { alreadyCheckedOut: true };
      }
      const entry = findRes.rows[0];

      const now = new Date();
      const tz = env.OUTLET_TIMEZONE || 'Asia/Kolkata';
      const exitDate = now.toLocaleDateString('en-GB', { timeZone: tz });
      const exitTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz });
      const finalFine = Math.max(0, parseFloat(fineAmount) || 0);
      const baseFee = computeParkingFee(entry.in_date, entry.entry_time, entry.created_at);
      const finalAmount = baseFee + finalFine;
      const finalPaymentMode = (paymentMode || entry.payment_mode || 'CASH').toUpperCase();
      const finalPaymentRef = ref || entry.payment_ref || null;

      // Insert to exit_history
      await client.query(`
        INSERT INTO exit_history (token_no,barcode,veh_type,veh_no,cust_name,mobile_no,rate,payment_mode,payment_ref,in_date,entry_time,exit_date,exit_time,fine_amount,total_amount,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      `, [
        entry.token_no, entry.barcode, entry.veh_type, entry.veh_no, entry.cust_name,
        entry.mobile_no, entry.rate, finalPaymentMode, finalPaymentRef, entry.in_date, entry.entry_time,
        exitDate, exitTime, finalFine, finalAmount, createdBy
      ]);

      // Soft delete the active entry (status=EXITED, deleted_at=now)
      await client.query(
        `UPDATE parking_entries SET status='EXITED', deleted_at=NOW(), exit_time=$1, total_amount=$2 WHERE id=$3`,
        [exitTime, finalAmount, entry.id]
      );

      return { entry, finalAmount, exitDate, exitTime };
    });

    if (result.alreadyCheckedOut) {
      return sendResponse(res, 404, false, `Vehicle Token #${tokenNo || barcode} has already exited or was not found.`, { errorCode: 'VEHICLE_ALREADY_EXITED' }, null, req);
    }

    await logAudit(req, 'VEHICLE_EXIT', `Token #${result.entry.token_no} (${result.entry.veh_no}) — ₹${result.finalAmount}`);

    return sendResponse(res, 200, true, `Vehicle Token #${result.entry.token_no} exit completed & archived to Exit History!`, {
      totalAmount: result.finalAmount
    }, null, req);
  } catch (err) {
    console.error('Checkout error:', err);
    return sendResponse(res, 500, false, err.message, { errorCode: 'CHECKOUT_FAILED' }, null, req);
  }
}

// ─── 6. Get History (with Pagination) ────────────────────────────────────────

async function getHistory(req, res) {
  try {
    const search = (req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params = [];
    let i = 1;

    if (search) {
      whereClause += ` AND (CAST(token_no AS TEXT) ILIKE $${i} OR veh_no ILIKE $${i} OR barcode ILIKE $${i} OR cust_name ILIKE $${i} OR mobile_no ILIKE $${i})`;
      params.push(`%${search}%`);
      i++;
    }

    // Advanced filters
    if (req.query.vehNo) { whereClause += ` AND veh_no ILIKE $${i++}`; params.push(`%${req.query.vehNo}%`); }
    if (req.query.mobileNo) { whereClause += ` AND mobile_no ILIKE $${i++}`; params.push(`%${req.query.mobileNo}%`); }
    if (req.query.paymentMode) { whereClause += ` AND UPPER(payment_mode) = $${i++}`; params.push(req.query.paymentMode.toUpperCase()); }
    if (req.query.dateFrom) { whereClause += ` AND exited_at >= $${i++}`; params.push(req.query.dateFrom); }
    if (req.query.dateTo) { whereClause += ` AND exited_at <= $${i++}`; params.push(req.query.dateTo); }

    // Single atomic query — COUNT(*) OVER() eliminates race condition between
    // a separate count query and data query during concurrent inserts.
    const [rowsRes, summaryRes] = await Promise.all([
      db.query(
        `SELECT *, COUNT(*) OVER() AS full_count FROM exit_history ${whereClause} ORDER BY id DESC LIMIT $${i} OFFSET $${i + 1}`,
        [...params, limit, offset]
      ),
      db.query(`
        SELECT
          COALESCE(SUM(total_amount),0) as total_amount,
          COALESCE(SUM(CASE WHEN UPPER(payment_mode)='GPAY' THEN total_amount ELSE 0 END),0) as gpay_amount,
          COALESCE(SUM(CASE WHEN UPPER(payment_mode)!='GPAY' THEN total_amount ELSE 0 END),0) as cash_amount
        FROM exit_history ${whereClause}
      `, params)
    ]);

    const total = rowsRes.rows.length > 0 ? parseInt(rowsRes.rows[0].full_count, 10) : 0;
    const s = summaryRes.rows[0] || {};
    const history = rowsRes.rows.map(formatEntryRow);

    return sendResponse(res, 200, true, 'History retrieved.', {
      count: history.length,
      summary: {
        totalAmount: parseFloat(s.total_amount || 0),
        cashAmount: parseFloat(s.cash_amount || 0),
        gpayAmount: parseFloat(s.gpay_amount || 0)
      },
      history
    }, buildPagination(page, limit, total), req);
  } catch (err) {
    return sendResponse(res, 500, false, err.message, {}, null, req);
  }
}

// ─── 7. Clear All Entries (Owner Only) ───────────────────────────────────────

async function clearAllEntries(req, res) {
  try {
    await db.transaction(async (client) => {
      await client.query(`UPDATE parking_entries SET status='EXITED', deleted_at=NOW() WHERE (status='ACTIVE' OR status IS NULL) AND deleted_at IS NULL`);
    });
    await logAudit(req, 'DELETE_ALL_ENTRIES', 'All active parking entries marked EXITED (soft delete)');
    return sendResponse(res, 200, true, 'All active parking entries cleared.', {}, null, req);
  } catch (err) {
    return sendResponse(res, 500, false, err.message, {}, null, req);
  }
}

// ─── 8. Dashboard Stats (from SQL views + PL/pgSQL function) ─────────────────

async function getDashboardStats(req, res) {
  try {
    const tz = env.OUTLET_TIMEZONE || 'Asia/Kolkata';
    const todayDate = new Date().toLocaleDateString('en-GB', { timeZone: tz });

    const [activeRes, todayRes, monthlyRes, peakRes] = await Promise.all([
      db.query(`SELECT COUNT(*) as active_count FROM parking_entries WHERE (status='ACTIVE' OR status IS NULL) AND deleted_at IS NULL`),
      db.query(`SELECT * FROM fn_get_daily_summary($1)`, [todayDate]),
      db.query(`SELECT * FROM vw_monthly_collection LIMIT 3`),
      db.query(`
        SELECT
          EXTRACT(HOUR FROM created_at AT TIME ZONE $1) AS hour,
          COUNT(*) AS entries
        FROM parking_entries
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY hour
        ORDER BY entries DESC
        LIMIT 5
      `, [tz])
    ]);

    const today = todayRes.rows[0] || {};
    return sendResponse(res, 200, true, 'Dashboard stats retrieved.', {
      activeVehicles: parseInt(activeRes.rows[0].active_count, 10),
      today: {
        vehicleCount: parseInt(today.vehicle_count || 0, 10),
        totalRevenue: parseFloat(today.total_revenue || 0),
        cashRevenue: parseFloat(today.cash_revenue || 0),
        gpayRevenue: parseFloat(today.gpay_revenue || 0),
        totalFine: parseFloat(today.total_fine || 0)
      },
      monthlyCollection: monthlyRes.rows,
      peakHours: peakRes.rows
    }, null, req);
  } catch (err) {
    return sendResponse(res, 500, false, err.message, {}, null, req);
  }
}

// ─── 9. Advanced Search ───────────────────────────────────────────────────────

async function advancedSearch(req, res) {
  try {
    const { vehNo, mobileNo, barcode, tokenNo, custName, dateFrom, dateTo, paymentMode, status = 'active' } = req.query;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    // Validate date range if provided
    if (dateFrom || dateTo) {
      try { validateDateRange(dateFrom, dateTo); } catch (e) {
        return sendResponse(res, 400, false, e.message, { errorCode: 'INVALID_DATE_RANGE' }, null, req);
      }
    }

    const useHistory = status === 'history' || status === 'exited';
    const table = useHistory ? 'exit_history' : 'parking_entries';
    const extraFilter = useHistory ? '' : `AND (status='ACTIVE' OR status IS NULL) AND deleted_at IS NULL`;

    let where = `WHERE 1=1 ${extraFilter}`;
    const params = [];
    let i = 1;

    if (vehNo) {
      // Normalize: strip spaces for flexible vehicle number matching
      const normalizedVeh = vehNo.replace(/\s+/g, '');
      where += ` AND REPLACE(UPPER(veh_no), ' ', '') ILIKE $${i++}`;
      params.push(`%${normalizedVeh.toUpperCase()}%`);
    }
    if (mobileNo) { where += ` AND mobile_no ILIKE $${i++}`; params.push(`%${mobileNo}%`); }
    if (barcode) { where += ` AND barcode ILIKE $${i++}`; params.push(`%${barcode}%`); }
    if (tokenNo) { where += ` AND token_no = $${i++}`; params.push(parseInt(tokenNo, 10)); }
    if (custName) { where += ` AND cust_name ILIKE $${i++}`; params.push(`%${custName}%`); }
    if (paymentMode) { where += ` AND UPPER(payment_mode) = $${i++}`; params.push(paymentMode.toUpperCase()); }

    if (dateFrom && useHistory) { where += ` AND exited_at >= $${i++}`; params.push(dateFrom); }
    if (dateTo && useHistory) { where += ` AND exited_at <= $${i++}`; params.push(dateTo); }
    if (dateFrom && !useHistory) { where += ` AND created_at >= $${i++}`; params.push(dateFrom); }
    if (dateTo && !useHistory) { where += ` AND created_at <= $${i++}`; params.push(dateTo); }

    // Single atomic query — COUNT(*) OVER() prevents count/data race condition
    const rowsRes = await db.query(
      `SELECT *, COUNT(*) OVER() AS full_count FROM ${table} ${where} ORDER BY id DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    );

    const total = rowsRes.rows.length > 0 ? parseInt(rowsRes.rows[0].full_count, 10) : 0;
    const results = rowsRes.rows.map(formatEntryRow);

    return sendResponse(res, 200, true, `Found ${total} records.`, { count: results.length, results },
      buildPagination(page, limit, total), req);
  } catch (err) {
    return sendResponse(res, 500, false, err.message, {}, null, req);
  }
}

// ─── 10. Export Report ────────────────────────────────────────────────────────

async function exportReport(req, res) {
  try {
    const format = (req.query.format || 'csv').toLowerCase();
    const reportType = (req.query.type || 'history').toLowerCase();
    const MAX_EXPORT_ROWS = 5000;

    let rows = [];
    let title = 'Parking Report';
    let summary = null;
    let columns = null;

    if (reportType === 'history') {
      // Optional date-range filter for exports
      let dateFilter = '';
      const dateParams = [];
      if (req.query.dateFrom) { dateFilter += ` AND exited_at >= $1`; dateParams.push(req.query.dateFrom); }
      if (req.query.dateTo) { dateFilter += ` AND exited_at <= $${dateParams.length + 1}`; dateParams.push(req.query.dateTo); }
      const result = await db.query(
        `SELECT token_no, veh_no, veh_type, cust_name, mobile_no, payment_mode, rate, fine_amount, total_amount, in_date, entry_time, exit_date, exit_time FROM exit_history WHERE 1=1${dateFilter} ORDER BY id DESC LIMIT ${MAX_EXPORT_ROWS}`,
        dateParams
      );
      rows = result.rows;
      title = 'Exit History Report';
      columns = ['token_no', 'veh_no', 'veh_type', 'cust_name', 'mobile_no', 'payment_mode', 'rate', 'fine_amount', 'total_amount', 'in_date', 'entry_time', 'exit_date', 'exit_time'];
    } else if (reportType === 'active') {
      const result = await db.query(
        `SELECT token_no, veh_no, veh_type, cust_name, mobile_no, payment_mode, rate, in_date, entry_time FROM parking_entries WHERE (status='ACTIVE' OR status IS NULL) AND deleted_at IS NULL ORDER BY id DESC LIMIT ${MAX_EXPORT_ROWS}`
      );
      rows = result.rows;
      title = 'Active Vehicles Report';
      columns = ['token_no', 'veh_no', 'veh_type', 'cust_name', 'mobile_no', 'payment_mode', 'rate', 'in_date', 'entry_time'];
    } else if (reportType === 'daily') {
      const result = await db.query(`SELECT * FROM vw_daily_collection LIMIT 90`);
      rows = result.rows;
      title = 'Daily Collection Report';
    } else if (reportType === 'monthly') {
      const result = await db.query(`SELECT * FROM vw_monthly_collection`);
      rows = result.rows;
      title = 'Monthly Collection Report';
    } else {
      return sendResponse(res, 400, false, `Unknown report type: ${reportType}. Supported: history, active, daily, monthly.`, {}, null, req);
    }

    const filename = `${reportType}_report_${new Date().toISOString().slice(0, 10)}`;
    await logAudit(req, 'EXPORT_REPORT', `Exported ${reportType} as ${format} (${rows.length} rows)`);
    return await sendExport(res, format, rows, filename, title, summary, columns);
  } catch (err) {
    return sendResponse(res, 500, false, err.message, {}, null, req);
  }
}

// ─── 11. Get Audit Logs (Paginated) ──────────────────────────────────────────

async function getAuditLogs(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    let whereClause = 'WHERE 1=1';
    const params = [];
    let i = 1;

    if (search) {
      whereClause += ` AND (action ILIKE $${i} OR username ILIKE $${i} OR details ILIKE $${i})`;
      params.push(`%${search}%`);
      i++;
    }

    // Single atomic query — COUNT(*) OVER() prevents count/data mismatch under concurrent writes
    const rowsRes = await db.query(
      `SELECT *, COUNT(*) OVER() AS full_count FROM audit_logs ${whereClause} ORDER BY id DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset]
    );

    const total = rowsRes.rows.length > 0 ? parseInt(rowsRes.rows[0].full_count, 10) : 0;
    const logs = rowsRes.rows;

    return sendResponse(res, 200, true, 'Audit logs retrieved.', { count: logs.length, logs },
      buildPagination(page, limit, total), req);
  } catch (err) {
    return sendResponse(res, 500, false, err.message, {}, null, req);
  }
}

// ─── 12. Backup Utility Handlers ─────────────────────────────────────────────

async function handleCreateBackup(req, res) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return sendResponse(res, 503, false, 'Durable backup storage is not configured.', {}, null, req);
    }
    const backupInfo = await createBackup();
    await logAudit(req, 'CREATE_BACKUP', `Created backup ${backupInfo.filename}`);
    const { path: _omit, ...safeInfo } = backupInfo;
    return sendResponse(res, 200, true, 'Backup created successfully.', safeInfo, null, req);
  } catch (err) {
    const status = err.message.includes('Durable backup storage') ? 503 : 500;
    return sendResponse(res, status, false, err.message, {}, null, req);
  }
}

async function handleListBackups(req, res) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return sendResponse(res, 503, false, 'Durable backup storage is not configured.', {}, null, req);
    }
    const backups = listBackups();
    return sendResponse(res, 200, true, 'Backups listed.', { count: backups.length, backups }, null, req);
  } catch (err) {
    const status = err.message.includes('Durable backup storage') ? 503 : 500;
    return sendResponse(res, status, false, err.message, {}, null, req);
  }
}

async function handleVerifyBackup(req, res) {
  try {
    const { filename } = req.body || {};
    if (!filename) return sendResponse(res, 400, false, 'Filename is required.', {}, null, req);
    const info = verifyBackup(filename);
    return sendResponse(res, 200, true, 'Backup verified.', info, null, req);
  } catch (err) {
    return sendResponse(res, 400, false, err.message, {}, null, req);
  }
}

async function handleRestoreBackup(req, res) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return sendResponse(res, 503, false, 'Durable backup storage is not configured.', {}, null, req);
    }
    const { filename, confirmText } = req.body || {};
    if (!filename) return sendResponse(res, 400, false, 'Filename is required.', {}, null, req);
    if (confirmText !== 'RESTORE_DATABASE_CONFIRM') {
      return sendResponse(res, 400, false,
        'Restoration requires confirmText = "RESTORE_DATABASE_CONFIRM".', {}, null, req);
    }
    try {
      const verification = verifyBackup(filename);
      if (!verification.valid) {
        return sendResponse(res, 400, false, 'Backup file failed verification. Only verified backups may be restored.', {}, null, req);
      }
    } catch (verifyErr) {
      return sendResponse(res, 400, false, `Backup verification failed: ${verifyErr.message}`, {}, null, req);
    }
    const result = await restoreBackup(filename, confirmText);
    await logAudit(req, 'RESTORE_BACKUP', `Restored database from ${filename}`);
    return sendResponse(res, 200, true, 'Database restored successfully.', result, null, req);
  } catch (err) {
    const status = err.message.includes('Durable backup storage') ? 503 : 500;
    return sendResponse(res, status, false, err.message, {}, null, req);
  }
}

// ─── 13. Job Trigger (Owner Only) ────────────────────────────────────────────

async function handleTriggerJob(req, res) {
  try {
    const { job, dryRun = false } = req.body || {};
    const validJobs = ['history-cleanup', 'audit-cleanup'];
    if (!job || !validJobs.includes(job)) {
      return sendResponse(res, 400, false,
        `Invalid job. Supported: ${validJobs.join(', ')}`, {}, null, req);
    }

    let result;
    if (job === 'history-cleanup') {
      result = await runHistoryCleanup({ dryRun: Boolean(dryRun) });
    } else if (job === 'audit-cleanup') {
      result = await runAuditCleanup({ dryRun: Boolean(dryRun) });
    }

    await logAudit(req, 'TRIGGER_JOB', `Manually triggered job: ${job} (dryRun=${dryRun})`);
    return sendResponse(res, 200, true, `Job '${job}' executed.`, { job, dryRun, result }, null, req);
  } catch (err) {
    return sendResponse(res, 500, false, err.message, {}, null, req);
  }
}

// ─── 14. Admin Diagnostics (Owner Only) ──────────────────────────────────────

async function getDiagnostics(req, res) {
  try {
    const [poolRes, dbVerRes, tableStatsRes] = await Promise.all([
      Promise.resolve(db.getPoolStats ? db.getPoolStats() : null),
      db.query('SELECT version() AS version'),
      db.query(`
        SELECT
          relname AS table_name,
          n_live_tup AS live_rows,
          n_dead_tup AS dead_rows,
          last_autovacuum
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
      `)
    ]);

    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    return sendResponse(res, 200, true, 'Diagnostics retrieved.', {
      server: {
        uptime: Math.round(uptime),
        memoryMB: {
          rss: (memUsage.rss / 1048576).toFixed(1),
          heapUsed: (memUsage.heapUsed / 1048576).toFixed(1),
          heapTotal: (memUsage.heapTotal / 1048576).toFixed(1)
        },
        nodeVersion: process.version
      },
      database: {
        version: dbVerRes.rows[0]?.version || 'unknown',
        pool: poolRes,
        tableStats: tableStatsRes.rows
      }
    }, null, req);
  } catch (err) {
    return sendResponse(res, 500, false, err.message, {}, null, req);
  }
}

module.exports = {
  getNextToken,
  getEntries,
  createEntry,
  lookupVehicle,
  checkoutVehicle,
  getHistory,
  clearAllEntries,
  getDashboardStats,
  advancedSearch,
  exportReport,
  getAuditLogs,
  handleCreateBackup,
  handleListBackups,
  handleVerifyBackup,
  handleRestoreBackup,
  handleTriggerJob,
  getDiagnostics
};

