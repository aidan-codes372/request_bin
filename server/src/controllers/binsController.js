const { findBinsByUserId, findBinByName, createBin, updateResponseStatus } = require('../models/bin')
const { validateEndpoint, validateResponseStatus } = require('../utils/validation')
const { AuthorizationError } = require('../utils/errors')

async function getBins(req, res) {
  const userId = req.userId

  const rows = await findBinsByUserId(userId)

  const bins = rows.map(
    ({ id, bin_name, request_count, created_at }) => ({
      id,
      bin_name,
      request_count,
      created_at
    })
  )

  return res.status(200).json(bins)
}

async function postBin(req, res) {
  const userId = req.userId
  const endpoint = req.body.url_endpoint

  // checking if endpoint is valid/unique
  await validateEndpoint(endpoint)

  const addedBin = await createBin(userId, endpoint)

  // success response
  res.status(201).json({
    'id': addedBin.id,
    'url_endpoint': `capture/${addedBin.bin_name}`,
  })
}

async function findOwnedBin(binName, userId) {
  const [bin] = await findBinByName(binName)

  if (bin && bin.user_id !== userId) {
    throw new AuthorizationError('Not authorized for this bin')
  }

  return bin
}

async function getResponseConfig(req, res) {
  const bin = await findOwnedBin(req.params.bin_name, req.userId)
  if (!bin) return res.status(404).json({ error: 'Bin not found' })

  return res.status(200).json({
    bin_name: bin.bin_name,
    response_status: bin.response_status,
  })
}

async function putResponseConfig(req, res) {
  const bin = await findOwnedBin(req.params.bin_name, req.userId)
  if (!bin) return res.status(404).json({ error: 'Bin not found' })
  const status = validateResponseStatus(req.body.response_status)

  const updated = await updateResponseStatus(bin.id, status)

  return res.status(200).json({
    bin_name: updated.bin_name,
    response_status: updated.response_status,
  })
}

module.exports = {
  getResponseConfig,
  putResponseConfig,
  getBins,
  postBin,
}
