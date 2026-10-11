const express = require('express');
const testRouter = express.Router();
const { getPool } = require('../db/postgres');
const Request = require('../../models/RequestPayload');

// Test-only helper: wipes captured requests for a bin so integration tests
// and local demos can start from a clean slate.
testRouter.delete('/bins/:bin_name/requests', async (req, res) => {
  const pool = getPool();

  const binResult = await pool.query(
    'SELECT id FROM bins WHERE bin_name = $1',
    [req.params.bin_name],
  );
  if (binResult.rows.length === 0) {
    return res.sendStatus(404);
  }
  const binId = binResult.rows[0].id;

  await Request.deleteMany({ bin_id: String(binId) });
  const deleted = await pool.query('DELETE FROM requests WHERE bin_id = $1', [binId]);
  await pool.query('UPDATE bins SET request_count = 0 WHERE id = $1', [binId]);

  res.status(200).json({ deleted: deleted.rowCount });
});

module.exports = { testRouter };
