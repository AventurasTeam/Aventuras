import TauriPluginWebSocket, { type Message } from '@tauri-apps/plugin-websocket'

type Handler<E> = ((event: E) => void) | null

/** The subset of the browser `WebSocket` the ComfyUI SDK uses, over Tauri's native socket. */
export class TauriWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  readonly CONNECTING = 0
  readonly OPEN = 1
  readonly CLOSING = 2
  readonly CLOSED = 3

  readyState = TauriWebSocket.CONNECTING
  onopen: Handler<Event> = null
  onmessage: Handler<{ data: string | ArrayBuffer }> = null
  onerror: Handler<Event> = null
  onclose: Handler<{ code: number; reason: string }> = null

  private socket: TauriPluginWebSocket | null = null
  private closeRequested = false

  constructor(url: string) {
    TauriPluginWebSocket.connect(url).then(
      (socket) => {
        if (this.closeRequested) {
          void socket.disconnect().catch(() => {})
          return
        }
        this.socket = socket
        socket.addListener((message) => this.receive(message))
        this.readyState = TauriWebSocket.OPEN
        this.onopen?.(new Event('open'))
      },
      () => {
        this.onerror?.(new Event('error'))
        this.finish(1006, '')
      },
    )
  }

  send(data: string) {
    void this.socket?.send(data).catch(() => this.onerror?.(new Event('error')))
  }

  close() {
    if (this.readyState >= TauriWebSocket.CLOSING) return
    this.closeRequested = true
    if (!this.socket) {
      this.finish(1000, '')
      return
    }
    this.readyState = TauriWebSocket.CLOSING
    void this.socket.disconnect().catch(() => {})
    this.finish(1000, '')
  }

  private receive(message: Message) {
    if (message.type === 'Text') {
      this.onmessage?.({ data: message.data })
    } else if (message.type === 'Binary') {
      this.onmessage?.({ data: new Uint8Array(message.data).buffer })
    } else if (message.type === 'Close') {
      this.finish(message.data?.code ?? 1006, message.data?.reason ?? '')
    }
  }

  private finish(code: number, reason: string) {
    if (this.readyState === TauriWebSocket.CLOSED) return
    this.readyState = TauriWebSocket.CLOSED
    this.onclose?.({ code, reason })
  }
}
