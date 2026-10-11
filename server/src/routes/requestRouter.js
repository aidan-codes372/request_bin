const express = require('express')
const requestRouter = express.Router()

const {
    getBins,
    postBin,
    getResponseConfig,
    putResponseConfig,
} = require('../controllers/binsController')

requestRouter.get('/', getBins)
requestRouter.post('/', postBin)
requestRouter.get('/:bin_name/response-config', getResponseConfig)
requestRouter.put('/:bin_name/response-config', putResponseConfig)

module.exports = { requestRouter }