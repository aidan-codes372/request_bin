jest.mock('dns', () => ({ promises: { lookup: jest.fn() } }))

const dns = require('dns').promises
const {
    validateDestination,
    createPinnedLookup,
    isBlockedIP,
    DestinationBlockedError,
} = require('../ssrfGuard')

beforeEach(() => {
    jest.clearAllMocks()
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
})

describe('isBlockedIP', () => {
    test.each([
        '0.0.0.0', '0.1.2.3', '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.0.1',
        '172.31.255.255', '192.168.1.1', '100.64.0.1', '100.127.255.255', '169.254.169.254',
        '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255', '198.18.0.1',
        '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'ff02::1',
        '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254',
        '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:db8::1', 'not-an-ip',
    ])('blocks %s', ip => {
        expect(isBlockedIP(ip)).toBe(true)
    })

    test.each([
        '8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '100.63.255.255',
        '100.128.0.1', '169.253.0.1', '11.0.0.1', '2606:4700:4700::1111', '2001:4860:4860::8888',
        '::ffff:8.8.8.8',
    ])('allows %s', ip => {
        expect(isBlockedIP(ip)).toBe(false)
    })
})

describe('validateDestination', () => {
    test('allows public http/https on any port and returns pinned IP', async () => {
        const r = await validateDestination('https://example.com:8443/hook?x=1')
        expect(r.ip).toBe('93.184.216.34')
        expect(r.family).toBe(4)
        expect(r.hostname).toBe('example.com')
        expect(r.port).toBe('8443')
        expect(dns.lookup).toHaveBeenCalledWith('example.com', expect.objectContaining({ all: true }))
    })

    test.each(['ftp://example.com', 'file:///etc/passwd', 'gopher://example.com', 'javascript:alert(1)'])(
        'rejects scheme %s', async u => {
            await expect(validateDestination(u)).rejects.toBeInstanceOf(DestinationBlockedError)
        })

    test('rejects invalid URLs and non-strings', async () => {
        await expect(validateDestination('nonsense')).rejects.toBeInstanceOf(DestinationBlockedError)
        await expect(validateDestination(undefined)).rejects.toBeInstanceOf(DestinationBlockedError)
    })

    test('error is typed with DESTINATION_BLOCKED code', async () => {
        const err = await validateDestination('http://127.0.0.1').catch(e => e)
        expect(err.name).toBe('DestinationBlockedError')
        expect(err.code).toBe('DESTINATION_BLOCKED')
    })

    test.each([
        'http://localhost', 'http://LOCALHOST:3000', 'http://foo.localhost', 'http://localhost.',
        'http://127.0.0.1', 'http://0.0.0.0', 'http://10.1.2.3', 'http://192.168.0.1',
        'http://172.20.0.1', 'http://100.64.0.1', 'http://169.254.169.254/latest/meta-data',
        'http://[::1]/', 'http://[fd00::1]/', 'http://[fe80::1]/', 'http://[::ffff:127.0.0.1]/',
        'http://[::ffff:7f00:1]/', 'http://224.0.0.1',
        // numeric / hex / octal forms
        'http://2130706433', 'http://0x7f000001', 'http://0x7f.0.0.1', 'http://017700000001',
        'http://0177.0.0.1', 'http://127.1', 'http://0', 'http://2852039166',
    ])('blocks literal %s without DNS', async u => {
        await expect(validateDestination(u)).rejects.toBeInstanceOf(DestinationBlockedError)
        expect(dns.lookup).not.toHaveBeenCalled()
    })

    test('rejects URL credentials', async () => {
        await expect(validateDestination('http://user:pw@example.com')).rejects.toBeInstanceOf(DestinationBlockedError)
    })

    test('blocks hostname resolving to private IP', async () => {
        dns.lookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }])
        await expect(validateDestination('http://evil.example')).rejects.toBeInstanceOf(DestinationBlockedError)
    })

    test('validates EVERY resolved IP (mixed public + private)', async () => {
        dns.lookup.mockResolvedValue([
            { address: '93.184.216.34', family: 4 },
            { address: '127.0.0.1', family: 4 },
        ])
        await expect(validateDestination('http://rebind.example')).rejects.toBeInstanceOf(DestinationBlockedError)
        dns.lookup.mockResolvedValue([
            { address: '2606:4700::1111', family: 6 },
            { address: '::1', family: 6 },
        ])
        await expect(validateDestination('http://rebind.example')).rejects.toBeInstanceOf(DestinationBlockedError)
    })

    test('blocks hostname resolving to IPv4-mapped IPv6 loopback', async () => {
        dns.lookup.mockResolvedValue([{ address: '::ffff:127.0.0.1', family: 6 }])
        await expect(validateDestination('http://mapped.example')).rejects.toBeInstanceOf(DestinationBlockedError)
    })

    test('blocks on DNS failure or empty result', async () => {
        dns.lookup.mockRejectedValue(new Error('ENOTFOUND'))
        await expect(validateDestination('http://nope.example')).rejects.toBeInstanceOf(DestinationBlockedError)
        dns.lookup.mockResolvedValue([])
        await expect(validateDestination('http://nope.example')).rejects.toBeInstanceOf(DestinationBlockedError)
    })

    test('allows public IP literals (v4 and v6)', async () => {
        expect((await validateDestination('http://8.8.8.8/x')).ip).toBe('8.8.8.8')
        const r = await validateDestination('http://[2606:4700:4700::1111]/')
        expect(r.ip).toBe('2606:4700:4700::1111')
        expect(r.family).toBe(6)
    })
})

describe('createPinnedLookup', () => {
    test('always returns pinned IP (single)', done => {
        createPinnedLookup('93.184.216.34')('anything.example', {}, (err, addr, fam) => {
            expect(err).toBeNull()
            expect(addr).toBe('93.184.216.34')
            expect(fam).toBe(4)
            done()
        })
    })

    test('supports all:true and callback-as-second-arg', done => {
        const lookup = createPinnedLookup('2606:4700::1111')
        lookup('x', { all: true }, (err, list) => {
            expect(list).toEqual([{ address: '2606:4700::1111', family: 6 }])
            lookup('x', (err2, addr, fam) => {
                expect(addr).toBe('2606:4700::1111')
                expect(fam).toBe(6)
                done()
            })
        })
    })
})
