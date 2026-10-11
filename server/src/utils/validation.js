const { findBinByName } = require('../models/bin')

const {
    ValidationError,
    NotUniqueError
} = require('./errors')

const MIN_LENGTH = 3
const MAX_LENGTH = 20

async function validateEndpoint(endpoint) {
    if (!endpoint) {
        throw new ValidationError('Missing endpoint')
    } else if (endpoint.length < MIN_LENGTH || endpoint.length > MAX_LENGTH) {
        throw new ValidationError('Endpoint must be between 3 and 20 characters')
    } else if (!hasValidChars(endpoint)) {
        throw new ValidationError('Endpoint must be made up of letters, numbers, and underscores')
    } else if (!await isUnique(endpoint)) {
        throw new NotUniqueError('Endpoint is taken, please choose another')
    }

    return true
}

const MIN_STATUS = 100
const MAX_STATUS = 999

function validateResponseStatus(status) {
    if (status === undefined || status === null) {
        throw new ValidationError('Missing response_status')
    } else if (!Number.isInteger(Number(status))) {
        throw new ValidationError('response_status must be an integer')
    } else if (Number(status) < MIN_STATUS || Number(status) > MAX_STATUS) {
        throw new ValidationError('response_status must be a valid HTTP status code')
    }

    return Number(status)
}

function hasValidChars(str) {
    return /^[a-zA-Z0-9_-]+$/.test(str)
}

async function isUnique(endpoint) {
    const matches = await findBinByName(endpoint)
    return matches.length === 0
}

module.exports = {
    validateEndpoint,
    validateResponseStatus
}
