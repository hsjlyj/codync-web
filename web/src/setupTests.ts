/// <reference types="vitest/globals" />
import '@testing-library/jest-dom'

// Mock WebSocket for testing
class MockWebSocket {
  static instances: MockWebSocket[] = []

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  readyState: number = WebSocket.CONNECTING

  constructor(
    public url: string,
    public protocols?: string | string[],
  ) {
    MockWebSocket.instances.push(this)
  }

  send() {
    // Mock send
  }

  close(code: number = 1000, reason: string = '') {
    this.readyState = WebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ code, reason })
    }
  }

  simulateOpen() {
    this.readyState = WebSocket.OPEN
    if (this.onopen) {
      this.onopen()
    }
  }

  simulateMessage(data: string) {
    if (this.onmessage) {
      this.onmessage({ data })
    }
  }

  simulateClose(code: number = 1000, reason: string = '') {
    this.readyState = WebSocket.CLOSED
    if (this.onclose) {
      this.onclose({ code, reason })
    }
  }

  static clearInstances() {
    MockWebSocket.instances = []
  }
}

// @ts-expect-error 演示/测试环境没有 WebSocket 时用 mock 顶替
global.WebSocket = MockWebSocket

// Cleanup after each test
afterEach(() => {
  MockWebSocket.clearInstances()
})
