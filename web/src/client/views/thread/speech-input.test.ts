/**
 * 语音输入封装测试：假识别器注入，覆盖 interim/final 流转、stop 清理、错误映射与支持探测。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { browserRecognizerFactory, createSpeechInput, speechSupported, type SpeechInputHandlers } from './speech-input'

class FakeRecognition {
  static latest: FakeRecognition | null = null
  lang = ''
  continuous = false
  interimResults = false
  startCount = 0
  stopCount = 0
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null

  constructor() {
    FakeRecognition.latest = this
  }

  start() {
    this.startCount += 1
  }

  stop() {
    this.stopCount += 1
  }

  /** 发一批识别结果：{text, isFinal} 列表（resultIndex 从 0 起覆盖本轮）。 */
  emit(...items: { text: string; isFinal: boolean }[]) {
    const results = items.map((item) => ({ isFinal: item.isFinal, 0: { transcript: item.text }, length: 1 }))
    this.onresult?.({ resultIndex: 0, results })
  }

  emitError(code: string) {
    this.onerror?.({ error: code })
  }

  emitEnd() {
    this.onend?.()
  }
}

const recorder = () => {
  const record = {
    final: [] as string[],
    interim: [] as string[],
    errors: [] as string[],
    ends: 0,
  }
  const handlers = {
    onFinal: (t: string) => record.final.push(t),
    onInterim: (t: string) => record.interim.push(t),
    onError: (m: string) => record.errors.push(m),
    onEnd: () => {
      record.ends += 1
    },
  } satisfies SpeechInputHandlers
  return { handlers, record }
}

afterEach(() => {
  FakeRecognition.latest = null
})

describe('createSpeechInput', () => {
  it('interim 实时回报，final 逐段追加后清掉 interim', () => {
    const { handlers, record } = recorder()
    const speech = createSpeechInput(FakeRecognition, handlers, 'zh-CN')
    speech.start()
    const recognition = FakeRecognition.latest
    expect(recognition?.continuous).toBe(true)
    expect(recognition?.interimResults).toBe(true)
    recognition?.emit({ text: '你好', isFinal: false })
    expect(record.interim.at(-1)).toBe('你好')
    recognition?.emit({ text: '你好，', isFinal: true }, { text: '世界', isFinal: false })
    expect(record.final).toEqual(['你好，'])
    expect(record.interim.at(-1)).toBe('世界')
    speech.stop()
  })

  it('stop() 调用识别器并摘除监听，重复 stop 幂等', () => {
    const { handlers, record } = recorder()
    const speech = createSpeechInput(FakeRecognition, handlers)
    speech.start()
    const recognition = FakeRecognition.latest
    speech.stop()
    expect(recognition?.stopCount).toBe(1)
    expect(record.ends).toBe(1)
    recognition?.emit({ text: '迟到的事件', isFinal: true })
    recognition?.emitEnd()
    expect(record.final).toEqual([])
    expect(record.ends).toBe(1)
    speech.stop()
    expect(recognition?.stopCount).toBe(1)
  })

  it('引擎自行结束 → onEnd 一次，且 start 守卫不重复建会话', () => {
    const { handlers, record } = recorder()
    const speech = createSpeechInput(FakeRecognition, handlers)
    speech.start()
    speech.start()
    const recognition = FakeRecognition.latest
    expect(recognition?.startCount).toBe(1)
    recognition?.emitEnd()
    expect(record.ends).toBe(1)
    expect(record.errors).toEqual([])
  })

  it('权限类错误映射为中文文案，no-speech 静默', () => {
    const { handlers, record } = recorder()
    const speech = createSpeechInput(FakeRecognition, handlers)
    speech.start()
    FakeRecognition.latest?.emitError('not-allowed')
    FakeRecognition.latest?.emitError('no-speech')
    FakeRecognition.latest?.emitError('weird-code')
    expect(record.errors).toEqual(['麦克风权限被拒绝：请在浏览器设置中允许后重试', '语音识别出错（weird-code）'])
    speech.stop()
  })

  it('识别中再次 start 不建新会话', () => {
    const { handlers } = recorder()
    const speech = createSpeechInput(FakeRecognition, handlers)
    speech.start()
    const first = FakeRecognition.latest
    speech.start()
    expect(FakeRecognition.latest).toBe(first)
    speech.stop()
  })
})

describe('支持探测', () => {
  it('jsdom 无 Web Speech API → 不支持，工厂为 null', () => {
    expect(speechSupported()).toBe(false)
    expect(browserRecognizerFactory()).toBeNull()
  })

  it('window 挂上 SpeechRecognition 后可探测到', () => {
    const w = window as unknown as { SpeechRecognition?: unknown }
    w.SpeechRecognition = FakeRecognition
    expect(speechSupported()).toBe(true)
    expect(browserRecognizerFactory()).toBe(FakeRecognition)
    delete w.SpeechRecognition
  })
})
