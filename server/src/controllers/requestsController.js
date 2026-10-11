const { getPool } = require('../db/postgres');
const Request = require('../../models/RequestPayload');

async function recordRequest(req, res) {
  const { bin_name } = req.params;
  const pool = getPool();

  try {
    const binResult = await pool.query(
      'SELECT id, response_status FROM bins WHERE bin_name = $1',
      [bin_name],
    );

    if (binResult.rows.length === 0) {
      return res.sendStatus(404);
    }

    const binId = binResult.rows[0].id;
    const responseStatus = binResult.rows[0].response_status;

    const idResult = await pool.query(
      "SELECT nextval('requests_id_seq') AS id",
    );
    const requestId = Number(idResult.rows[0].id);
    const receivedAt = new Date();

    const requestPayload = {
      method: req.method,
      path: req.originalUrl,
      headers: req.headers,
      body: req.rawText ?? null,
      received_at: receivedAt,
    };

    await Request.create({
      _id: requestId,
      bin_id: String(binId),
      request_payload: requestPayload,
    });

    await pool.query(
      `INSERT INTO requests (id, bin_id, method, path, headers, body)
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        requestId,
        binId,
        req.method,
        req.originalUrl,
        JSON.stringify(req.headers),
        req.parsedBody !== undefined
          ? JSON.stringify(req.parsedBody)
          : req.rawText,
      ],
    );

    await pool.query(
      'UPDATE bins SET request_count = request_count + 1 WHERE id = $1',
      [binId],
    );

    const io = req.app.get('io');
    io.to(bin_name).emit('new-request', {
      id: requestId,
      bin_id: binId,
      method: req.method,
      path: req.originalUrl,
      received_at: receivedAt,
    });

    res.status(responseStatus).json({ received: true });
  } catch (err) {
    console.error('Error capturing request:', err);
    res.sendStatus(500);
  }
}

async function getBinRequests(req, res) {
  const { bin_name } = req.params;
  const pool = getPool();

  try {
    const binResult = await pool.query(
      'SELECT id, user_id FROM bins WHERE bin_name = $1',
      [bin_name],
    );

    if (binResult.rows.length === 0) {
      return res.status(404).json({ error: 'Bin not found' });
    }

    const bin = binResult.rows[0];

    if (bin.user_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized for this bin' });
    }

    const requestsResult = await pool.query(
      `SELECT id, method, path, headers, body, received_at
      FROM requests
      WHERE bin_id = $1
      ORDER BY received_at DESC`,
      [bin.id],
    );

    res.status(200).json(requestsResult.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function getRawRequest(req, res) {
  const { bin_name, id } = req.params;
  const numericId = Number(id);

  if (!Number.isInteger(numericId)) {
    return res.sendStatus(404);
  }

  const pool = getPool();

  try {
    const binResult = await pool.query(
      'SELECT id, user_id FROM bins WHERE bin_name = $1',
      [bin_name],
    );

    if (binResult.rows.length === 0) {
      return res.sendStatus(404);
    }

    const bin = binResult.rows[0];

    if (bin.user_id !== req.userId) {
      return res.status(403).json({ error: 'Not authorized for this bin' });
    }

    const doc = await Request.findOne({ _id: numericId });

    if (!doc || doc.bin_id !== String(bin.id)) {
      return res.sendStatus(404);
    }

    res.status(200).json({ request_payload: doc.request_payload });
  } catch (err) {
    console.error('Error fetching raw request:', err);
    res.sendStatus(500);
  }
}

module.exports = {
  recordRequest,
  getBinRequests,
  getRawRequest,
};
