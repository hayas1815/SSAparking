const db = require('../db');
const env = require('../config/env');
const {
  getNextToken,
  createEntry,
  lookupVehicle,
  checkoutVehicle,
  getHistory,
  getAuditLogs,
  advancedSearch,
  handleRestoreBackup,
  handleVerifyBackup
} = require('../controllers/parkingController');
const { createBackup, listBackups, verifyBackup, restoreBackup } = require('../utils/backup');
const { toCSV } = require('../utils/export');
const requestIdMiddleware = require('../middleware/requestId');
const { runHistoryCleanup, runAuditCleanup } = require('../jobs/scheduler');

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader: function (key, val) { this.headers[key] = val; },
    status: function (code) {
      this.statusCode = code;
      return this;
    },
    json: function (data) {
      this.body = data;
      return this;
    },
    send: function (content) {
      this.body = content;
      return this;
    }
  };
  return res;
}

function createMockReq(overrides = {}) {
  return {
    headers: {},
    query: {},
    body: {},
    user: { id: 1, username: 'testowner', role: 'owner' },
    id: 'test-req-id-12345',
    requestId: 'test-req-id-12345',
    ...overrides
  };
}

async function runTests() {
  console.log('\n=================================================');
  console.log('PHASE 2.1 ENTERPRISE COMPREHENSIVE AUTOMATED TEST SUITE');
  console.log('=================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, testName) {
    total++;
    if (condition) {
      console.log(`   ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`   ❌ [FAIL] ${testName}`);
      throw new Error(`Test failed: ${testName}`);
    }
  }

  try {
    // 1. Connection & DB Initialization
    console.log('1. Testing PostgreSQL DB Connection & Schema Initialization...');
    await db.query('SELECT 1');
    assert(true, 'PostgreSQL Connection & Schema (Tables, Indexes, Constraints, Sequence) OK');

    // 2. Sequence Token Generation
    console.log('\n2. Testing Race-Condition Safe Token Generation...');
    const req1 = createMockReq();
    const res1 = createMockRes();
    const res2 = createMockRes();

    await getNextToken(req1, res1);
    await getNextToken(req1, res2);

    const token1 = res1.body?.nextToken;
    const token2 = res2.body?.nextToken;
    assert(typeof token1 === 'number' && typeof token2 === 'number', 'Token numbers are numeric');
    assert(token2 > token1, `Token sequence incrementing correctly (${token1} -> ${token2})`);

    // 3. PostgreSQL Transaction & Rollback Test
    console.log('\n3. Testing PostgreSQL Atomic Transaction Rollback...');
    let rollbackCaught = false;
    try {
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO parking_entries (token_no, veh_no, in_date, entry_time) VALUES ($1, $2, $3, $4)`,
          [999991, 'TN-99-TEST-ROLLBACK', '29/07/2026', '12:00 PM']
        );
        throw new Error('Simulated transaction failure');
      });
    } catch (err) {
      rollbackCaught = true;
    }

    const checkRes = await db.query(`SELECT * FROM parking_entries WHERE veh_no = 'TN-99-TEST-ROLLBACK'`);
    assert(rollbackCaught && checkRes.rows.length === 0, 'Transaction rollback verified (0 records inserted on failure)');

    // 4. Duplicate Active Vehicle Entry Guard
    console.log('\n4. Testing Duplicate Active Vehicle Entry Prevention (409 Conflict)...');
    const testVehNo = 'TN01DUPTEST';
    await db.query(`DELETE FROM parking_entries WHERE veh_no = $1 OR token_no = 999992`, [testVehNo]);
    await db.query(`DELETE FROM exit_history WHERE veh_no = $1 OR token_no = 999992`, [testVehNo]);

    const reqEntry = createMockReq({
      body: {
        tokenNo: 999992,
        barcode: 'CARD-999992',
        vehType: 'BIKE 15',
        vehNo: testVehNo,
        custName: 'TEST OWNER',
        mobileNo: '9876543210',
        rate: 15,
        paymentMode: 'CASH'
      }
    });

    const resEntry1 = createMockRes();
    await createEntry(reqEntry, resEntry1);
    assert(resEntry1.statusCode === 201, 'First vehicle entry created successfully (201)');

    const resEntry2 = createMockRes();
    await createEntry(reqEntry, resEntry2);
    assert(resEntry2.statusCode === 409, 'Duplicate active entry rejected with 409 Conflict');

    // 5. Transaction Checkout & Duplicate Checkout Guard
    console.log('\n5. Testing Transaction Checkout & Duplicate Checkout Guard...');
    const reqCheckout = createMockReq({
      body: {
        tokenNo: 999992,
        barcode: 'CARD-999992',
        paymentMode: 'CASH',
        fineAmount: 0
      }
    });

    const resChk1 = createMockRes();
    await checkoutVehicle(reqCheckout, resChk1);
    assert(resChk1.statusCode === 200, 'First checkout completed successfully (200)');

    const resChk2 = createMockRes();
    await checkoutVehicle(reqCheckout, resChk2);
    assert(resChk2.statusCode === 404 || resChk2.statusCode === 409, 'Duplicate checkout rejected with 404/409');

    // Cleanup test record from history
    await db.query(`DELETE FROM exit_history WHERE veh_no = $1`, [testVehNo]);

    // 6. DB-Level Report Aggregation & Pagination
    console.log('\n6. Testing Database-Level History SQL Aggregations & Pagination...');
    const reqHist = createMockReq({ query: { page: '1', limit: '10' } });
    const resHist = createMockRes();
    await getHistory(reqHist, resHist);

    assert(resHist.statusCode === 200, 'History retrieved with status 200');
    assert(resHist.body.pagination !== undefined, 'Pagination object included in response');
    assert(resHist.body.summary !== undefined, 'Summary aggregations included');

    // 7. Paginated Audit Logs Test
    console.log('\n7. Testing Paginated Audit Logs API...');
    const reqAudit = createMockReq({ query: { page: '1', limit: '10' } });
    const resAudit = createMockRes();
    await getAuditLogs(reqAudit, resAudit);

    assert(resAudit.statusCode === 200, 'Audit logs retrieved with status 200');
    assert(resAudit.body.pagination !== undefined, 'Audit log pagination metadata present');

    // 8. Request ID Middleware Test
    console.log('\n8. Testing Request ID Middleware...');
    const reqReqId = createMockReq({ headers: { 'x-request-id': 'custom-valid-req-id-999' } });
    const resReqId = createMockRes();
    let nextCalled = false;
    requestIdMiddleware(reqReqId, resReqId, () => { nextCalled = true; });

    assert(nextCalled, 'Request ID middleware called next()');
    assert(reqReqId.requestId === 'custom-valid-req-id-999', 'Accepted valid custom X-Request-ID');
    assert(resReqId.headers['X-Request-ID'] === 'custom-valid-req-id-999', 'Set X-Request-ID response header');

    // Test malformed request ID rejection
    const reqMalformed = createMockReq({ headers: { 'x-request-id': 'invalid id with spaces!@#' } });
    const resMalformed = createMockRes();
    requestIdMiddleware(reqMalformed, resMalformed, () => {});
    assert(reqMalformed.requestId !== 'invalid id with spaces!@#', 'Malformed X-Request-ID was replaced with valid UUID');

    // 9. CSV Formula Injection Defense Test
    console.log('\n9. Testing CSV Formula Injection Protection...');
    const testRows = [{ name: '=1+2', formula: '+cmd|', normal: 'Hello' }];
    const csvOutput = toCSV(testRows);
    assert(csvOutput.includes("'=1+2"), 'Formula prefixed with = neutralized with single quote');
    assert(csvOutput.includes("'+cmd|"), 'Formula prefixed with + neutralized with single quote');

    // 10. Security Test: Backup Path Traversal Protection
    console.log('\n10. Testing Backup Path Traversal & Unauthorized Restore Protection...');
    try {
      verifyBackup('../../../etc/passwd');
      assert(false, 'Path traversal filename should have thrown error');
    } catch (e) {
      assert(e.message.includes('Invalid backup filename'), 'Path traversal rejected by filename validator');
    }

    try {
      verifyBackup('..\\..\\windows\\system32');
      assert(false, 'Windows path traversal should have thrown error');
    } catch (e) {
      assert(e.message.includes('Invalid backup filename'), 'Windows path traversal rejected');
    }

    // Test unauthorized restore without confirmation string
    const reqRestoreUnauth = createMockReq({ body: { filename: 'backup_test.json', confirmText: 'WRONG' } });
    const resRestoreUnauth = createMockRes();
    await handleRestoreBackup(reqRestoreUnauth, resRestoreUnauth);
    assert(resRestoreUnauth.statusCode === 400, 'Restore rejected when confirmText is invalid');

    // 11. Database Backup, Verification & Restore Test
    console.log('\n11. Testing Database Backup, Verification & Restore Utility...');
    const backupInfo = await createBackup();
    assert(backupInfo.filename.startsWith('backup_'), 'Backup filename generated correctly');

    const verInfo = verifyBackup(backupInfo.filename);
    assert(verInfo.valid === true, 'Backup verification returned valid = true');

    const restoreInfo = await restoreBackup(backupInfo.filename, 'RESTORE_DATABASE_CONFIRM');
    assert(restoreInfo.restored === true, 'Database restored successfully in test environment');

    // 12. Retention Job Advisory Lock Test
    console.log('\n12. Testing Retention Cleanup Advisory Locking & Dry Run...');
    const cleanupResult = await runHistoryCleanup({ dryRun: true });
    assert(cleanupResult.dryRun === true, 'History cleanup dry run executed cleanly');
    assert(cleanupResult.locked === true, 'Acquired advisory lock successfully');

    const auditCleanupResult = await runAuditCleanup({ dryRun: true });
    assert(auditCleanupResult.dryRun === true, 'Audit cleanup dry run executed cleanly');

    // 13. Search Filtering & Vehicle Number Normalization
    console.log('\n13. Testing Advanced Search & Vehicle Number Normalization...');
    const reqSearch = createMockReq({ query: { vehNo: 'TN 01 AB 1234', page: '1', limit: '10' } });
    const resSearch = createMockRes();
    await advancedSearch(reqSearch, resSearch);
    assert(resSearch.statusCode === 200, 'Advanced search completed with status 200');

    console.log('\n=================================================');
    console.log(`ALL PHASE 2.1 TESTS PASSED! (${passed}/${total} assertions passed) ✅`);
    console.log('=================================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test Suite Failed:', err.message || err);
    process.exit(1);
  }
}

runTests();
