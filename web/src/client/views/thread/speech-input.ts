/**
 * 浏览器语音识别封装（Phase 3）：Web Speech API（SpeechRecognition / webkitSpeechRecognition）。
 * 纯浏览器本地识别，不经主机（主机的 voice* 是云端 TTS/STT，另属通话功能）。
 * 识别器实例由调用方注入（测试替身），浏览器差异在 supported() 里收口。
 */

/** Web Speech API 的最小类型（lib.dom 未含 webkitSpeechRecognition，本地收口）。 */
interface SpeechRecognitionAlternativeLike {
  transcript: string
}
interface SpeechRecognitionResultLike {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternativeLike
}
interface SpeechRecognitionResultListLike {
  length: number
  [index: number]: SpeechRecognitionResultLike
}
interface SpeechRecognitionEventLike {
  resultIndex: number
  results: SpeechRecognitionResultListLike
}
interface SpeechRecognitionErrorEventLike {
  error: string
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface SpeechWindow {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

/** 当前浏览器是否支持语音识别（SSR/不支持时 false，按钮据此隐藏）。 */
export function speechSupported(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as SpeechWindow
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}

export interface SpeechInputHandlers {
  /** 一段已确定的转写文本（可追加进输入框）。 */
  onFinal: (text: string) => void
  /** 未确定的中间结果（整体替换展示）。 */
  onInterim: (text: string) => void
  onError: (message: string) => void
  /** 识别结束（用户停止或引擎自行断开）——listening 状态复位。 */
  onEnd: () => void
}

export interface SpeechInput {
  start: () => void
  stop: () => void
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝：请在浏览器设置中允许后重试',
  'service-not-allowed': '语音识别服务不可用：请检查浏览器权限设置',
  'no-speech': '未检测到语音，请再试一次',
  'audio-capture': '未找到可用的麦克风设备',
  network: '语音识别服务网络异常',
}

/** 创建一段听写会话：interim 实时回报，final 逐段追加；stop() 幂等。 */
export function createSpeechInput(
  recognizerFactory: SpeechRecognitionCtor,
  handlers: SpeechInputHandlers,
  lang = 'zh-CN',
): SpeechInput {
  let recognition: SpeechRecognitionLike | null = null
  let stopped = true

  const teardown = () => {
    if (!recognition) return
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
    recognition = null
  }

  return {
    start() {
      if (!stopped) return
      stopped = false
      const session = new recognizerFactory()
      recognition = session
      session.lang = lang
      session.continuous = true
      session.interimResults = true
      session.onresult = (event) => {
        let interim = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          const text = result?.[0]?.transcript ?? ''
          if (result?.isFinal) handlers.onFinal(text)
          else interim += text
        }
        if (interim) handlers.onInterim(interim)
        else handlers.onInterim('')
      }
      session.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return // 静默结束，不算错误
        handlers.onError(ERROR_TEXT[event.error] ?? `语音识别出错（${event.error}）`)
      }
      session.onend = () => {
        teardown()
        if (!stopped) stopped = true // 引擎自行断开（如静音超时）
        handlers.onEnd()
      }
      try {
        session.start()
      } catch {
        teardown()
        stopped = true
        handlers.onError('无法启动语音识别：可能已在识别中')
      }
    },
    stop() {
      if (stopped) return
      stopped = true
      const session = recognition
      teardown()
      try {
        session?.stop()
      } catch {
        /* 已停止的识别器 stop() 抛错无碍 */
      }
      handlers.onEnd()
    },
  }
}

/** 浏览器识别器工厂（支持时）；不支持返回 null，按钮层据此隐藏。 */
export function browserRecognizerFactory(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as SpeechWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}
