/**
 * close code → 重连策略断言（试金 QA 基线：channel.rs close 模块 + devices.rs RejectCode）。
 * 纯函数测试，不需要真实 socket。
 */
import { describe, expect, it } from 'vitest'
import { CHANNEL_CLOSE_CODES, REJECT_CLOSE_CODES } from '@codync/shared'
import { closePolicyOf } from './channel-transport'

describe('closePolicyOf', () => {
  it('4011 rekey 与 1011 timeout：立即重连（换钥/超时非故障）', () => {
    expect(closePolicyOf(CHANNEL_CLOSE_CODES.rekey)).toEqual({ action: 'reconnect' })
    expect(closePolicyOf(CHANNEL_CLOSE_CODES.timeout)).toEqual({ action: 'reconnect' })
  })

  it('4100 paired：停止重连——配对码一次性，重开普通通道由调用方负责', () => {
    expect(closePolicyOf(CHANNEL_CLOSE_CODES.paired)).toEqual({
      action: 'stop',
      reason: '配对成功，正在以已授权设备重新连接…',
    })
  })

  it('4001 unauthorized：限次重试（带提示）', () => {
    const policy = closePolicyOf(REJECT_CLOSE_CODES.unauthorized)
    expect(policy).toMatchObject({ action: 'retry-limited' })
    if (policy.action === 'retry-limited') expect(policy.reason).toContain('重试')
  })

  it('4008 rateLimited：慢退避重连', () => {
    expect(closePolicyOf(REJECT_CLOSE_CODES.rateLimited)).toEqual({ action: 'reconnect-slow' })
  })

  it('4003 revoked / 4400 unsupportedVersion / 4410 pairingClosed：终止并给出用户话术', () => {
    for (const code of [
      REJECT_CLOSE_CODES.revoked,
      REJECT_CLOSE_CODES.unsupportedVersion,
      REJECT_CLOSE_CODES.pairingClosed,
    ]) {
      const policy = closePolicyOf(code)
      expect(policy.action).toBe('stop')
      if (policy.action === 'stop') expect(policy.reason.length).toBeGreaterThan(0)
    }
    expect(closePolicyOf(REJECT_CLOSE_CODES.revoked)).toHaveProperty('reason', expect.stringContaining('重新配对'))
    expect(closePolicyOf(REJECT_CLOSE_CODES.unsupportedVersion)).toHaveProperty('reason', expect.stringContaining('升级主机'))
    expect(closePolicyOf(REJECT_CLOSE_CODES.pairingClosed)).toHaveProperty('reason', expect.stringContaining('配对码'))
  })

  it('未知 close code：默认重连（不断链即放弃）', () => {
    expect(closePolicyOf(3000)).toEqual({ action: 'reconnect' })
    expect(closePolicyOf(4500)).toEqual({ action: 'reconnect' })
  })
})
