import { describe, expect, it } from 'vitest'
import { channelUrlOf, normalizeChannelUrl, parsePairingUrl } from './pairing-url'

// 配对 URL 样例按 host/src/service/mod.rs::pairing_url 的格式拼装（id/sk 为示意值）。
const SAMPLE =
  'codync://pair?v=3&name=Kevin%27s%20Mac&' +
  'id=NHUPmL1Z_PyUbaRaqr6TOw&sk=h0tFVdlMSTrUa0LLoHMDwEbTBaTPU8zEP8KydX_7PGc&' +
  'bk=mE0Tt0hK8Bq0B1n9Zq3F5bWl-2nH4rJ8sK1yV3uX5aA&code=AbCdEf123456&' +
  'urls=http%3A%2F%2F192.168.1.5%3A19222%2Chttp%3A%2F%2F10.0.0.2%3A19222'

describe('parsePairingUrl', () => {
  it('parses a full pairing QR URL into its fields', () => {
    const parsed = parsePairingUrl(SAMPLE)
    expect(parsed).not.toBeNull()
    expect(parsed!.name).toBe("Kevin's Mac")
    expect(parsed!.computerId).toBe('NHUPmL1Z_PyUbaRaqr6TOw')
    expect(parsed!.code).toBe('AbCdEf123456')
    expect(parsed!.urls).toEqual(['http://192.168.1.5:19222', 'http://10.0.0.2:19222'])
    expect(parsed!.dev).toBe(false)
  })

  it('flags a dev-scheme URL', () => {
    expect(parsePairingUrl(SAMPLE.replace('codync://', 'codync-dev://'))!.dev).toBe(true)
  })

  it('keeps an optional cloud field', () => {
    expect(parsePairingUrl(`${SAMPLE}&cloud=https%3A%2F%2Fapi.codync.dev`)!.cloud).toBe('https://api.codync.dev')
  })

  it('rejects other schemes and malformed links', () => {
    expect(parsePairingUrl('https://example.com/pair?v=3')).toBeNull()
    expect(parsePairingUrl('codync://pair?v=2&id=x&sk=y&code=z')).toBeNull()
    expect(parsePairingUrl('codync://pair?v=3&id=x&sk=y')).toBeNull()
    expect(parsePairingUrl('   ')).toBeNull()
    expect(parsePairingUrl('not a url')).toBeNull()
  })
})

describe('channelUrlOf / normalizeChannelUrl', () => {
  it('converts host addresses to /channel websocket addresses', () => {
    expect(channelUrlOf('http://192.168.1.5:19222')).toBe('ws://192.168.1.5:19222/channel')
    expect(channelUrlOf('https://host.example')).toBe('wss://host.example/channel')
  })

  it('keeps an explicit /channel path and ws scheme', () => {
    expect(channelUrlOf('ws://localhost:19222/channel')).toBe('ws://localhost:19222/channel')
    expect(normalizeChannelUrl('wss://tunnel.example/channel')).toBe('wss://tunnel.example/channel')
    expect(normalizeChannelUrl('http://localhost:19222')).toBe('ws://localhost:19222/channel')
  })
})
