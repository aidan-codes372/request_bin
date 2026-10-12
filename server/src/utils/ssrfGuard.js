const dns = require('dns').promises
const net = require('net')
const { DestinationBlockedError } = require('./errors')

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

// [network, prefixLength] blocked IPv4 ranges
const BLOCKED_V4 = [
    ['0.0.0.0', 8],        // "this" network incl. 0.0.0.0
    ['10.0.0.0', 8],       // RFC1918
    ['100.64.0.0', 10],    // CGNAT
    ['127.0.0.0', 8],      // loopback
    ['169.254.0.0', 16],   // link-local (cloud metadata)
    ['172.16.0.0', 12],    // RFC1918
    ['192.0.0.0', 24],     // IETF protocol assignments
    ['192.0.2.0', 24],     // TEST-NET-1
    ['192.88.99.0', 24],   // 6to4 relay
    ['192.168.0.0', 16],   // RFC1918
    ['198.18.0.0', 15],    // benchmarking
    ['198.51.100.0', 24],  // TEST-NET-2
    ['203.0.113.0', 24],   // TEST-NET-3
    ['224.0.0.0', 4],      // multicast
    ['240.0.0.0', 4],      // reserved + broadcast
]

function v4ToInt(ip) {
    return ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0)
}

function inV4Range(int, [network, bits]) {
    const size = 2 ** (32 - bits)
    const start = v4ToInt(network)
    return int >= start && int < start + size
}

function isBlockedIPv4(ip) {
    const int = v4ToInt(ip)
    return BLOCKED_V4.some(range => inV4Range(int, range))
}

// Parse an IPv6 string into 8 16-bit groups, or null if invalid.
function parseIPv6(input) {
    let ip = input.split('%')[0] // strip zone id
    if (ip.includes('.')) {
        const idx = ip.lastIndexOf(':')
        const v4 = ip.slice(idx + 1)
        if (!net.isIPv4(v4)) return null
        const n = v4ToInt(v4)
        ip = `${ip.slice(0, idx + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
    }
    const halves = ip.split('::')
    if (halves.length > 2) return null
    const head = halves[0] ? halves[0].split(':') : []
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
    let groups
    if (halves.length === 2) {
        const fill = 8 - head.length - tail.length
        if (fill < 1) return null
        groups = [...head, ...Array(fill).fill('0'), ...tail]
    } else {
        groups = head
    }
    if (groups.length !== 8) return null
    const out = groups.map(g => (/^[0-9a-fA-F]{1,4}$/.test(g) ? parseInt(g, 16) : NaN))
    return out.some(Number.isNaN) ? null : out
}

function isBlockedIPv6(ip) {
    const g = parseIPv6(ip)
    if (!g) return true // unparseable: fail closed
    const first6Zero = g.slice(0, 5).every(x => x === 0)
    const embeddedV4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`
    // ::, ::1
    if (g.slice(0, 7).every(x => x === 0) && g[7] <= 1) return true
    // IPv4-mapped ::ffff:a.b.c.d and deprecated IPv4-compatible ::a.b.c.d
    if (first6Zero && (g[5] === 0xffff || g[5] === 0)) return isBlockedIPv4(embeddedV4)
    // NAT64 64:ff9b::/96
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) {
        return isBlockedIPv4(embeddedV4)
    }
    // 6to4 2002::/16 embeds an IPv4 address
    if (g[0] === 0x2002) {
        return isBlockedIPv4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`)
    }
    if ((g[0] & 0xfe00) === 0xfc00) return true // ULA fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return true // link-local fe80::/10
    if ((g[0] & 0xffc0) === 0xfec0) return true // deprecated site-local
    if ((g[0] & 0xff00) === 0xff00) return true // multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true // documentation
    if (g[0] === 0x0100 && g.slice(1, 4).every(x => x === 0)) return true // discard
    return false
}

function isBlockedIP(ip) {
    const family = net.isIP(ip)
    if (family === 4) return isBlockedIPv4(ip)
    if (family === 6) return isBlockedIPv6(ip)
    return true
}

function blocked(reason) {
    return new DestinationBlockedError(`Destination blocked: ${reason}`)
}

/**
 * Validate a destination URL and return a pinned IP for the outbound connection.
 * Resolves DNS and checks EVERY returned address.
 * @returns {Promise<{url: URL, hostname: string, ip: string, family: 4|6, port: string, protocol: string}>}
 * @throws {DestinationBlockedError}
 */
async function validateDestination(rawUrl) {
    let url
    try {
        url = new URL(rawUrl)
    } catch {
        throw blocked('invalid URL')
    }
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw blocked('scheme not allowed')
    if (url.username || url.password) throw blocked('credentials in URL not allowed')

    // WHATWG URL parsing normalizes decimal/hex/octal IPv4 forms to dotted quad.
    let hostname = url.hostname.replace(/\.$/, '').toLowerCase()
    if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1)
    if (!hostname) throw blocked('missing host')

    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
        throw blocked('localhost not allowed')
    }

    let addresses
    if (net.isIP(hostname)) {
        addresses = [{ address: hostname, family: net.isIP(hostname) }]
    } else {
        try {
            addresses = await dns.lookup(hostname, { all: true, verbatim: true })
        } catch {
            throw blocked('host could not be resolved')
        }
        if (!Array.isArray(addresses) || addresses.length === 0) {
            throw blocked('host could not be resolved')
        }
    }

    for (const { address } of addresses) {
        if (isBlockedIP(address)) throw blocked('resolves to a non-public address')
    }

    const { address, family } = addresses[0]
    return {
        url,
        hostname,
        ip: address,
        family: net.isIP(address) || family,
        port: url.port,
        protocol: url.protocol,
    }
}

/**
 * dns.lookup-compatible function that always returns the pinned IP.
 * Pass as the `lookup` option of http(s).request to prevent DNS rebinding
 * while keeping Host/SNI based on the original hostname.
 */
function createPinnedLookup(ip) {
    const family = net.isIP(ip)
    return (_hostname, options, callback) => {
        const cb = typeof options === 'function' ? options : callback
        if (options && typeof options === 'object' && options.all) {
            return cb(null, [{ address: ip, family }])
        }
        return cb(null, ip, family)
    }
}

module.exports = {
    validateDestination,
    createPinnedLookup,
    isBlockedIP,
    DestinationBlockedError,
}
