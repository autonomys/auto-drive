import Websocket from 'websocket'

type RPCMessage = {
  jsonrpc: string
  method: string
  params: unknown
  id: number
}

export type WS = {
  send: (message: Omit<RPCMessage, 'id'>) => Promise<unknown>
  on: (callback: (event: RPCMessage) => void) => void
  off: (callback: (event: RPCMessage) => void) => void
}

export const createWS = (endpoint: string): WS => {
  let ws: Websocket.w3cwebsocket
  let onMessageCallbacks: ((event: RPCMessage) => void)[] = []

  const handleConnection = () => {
    ws = new Websocket.w3cwebsocket(endpoint)

    ws.onerror = (event) => {
      const errorDetails = {
        readyState: ws.readyState,
        url: endpoint,
        message: event.message || 'Unknown error',
      }

      console.error('WebSocket connection error', errorDetails)

      setTimeout(() => {
        console.log(`Reconnecting to RPC Web Socket (${endpoint})`)
        handleConnection()
      }, 10_000)
    }

    ws.onmessage = (event) => {
      console.debug(`Received message from WebSocket (${endpoint})`)
      onMessageCallbacks.forEach((callback) =>
        callback(JSON.parse(event.data.toString())),
      )
    }

    ws.onclose = (event) => {
      console.log(
        `WebSocket connection closed (${event.code}) due to ${event.reason}.`,
      )
    }
  }

  handleConnection()

  const connected: Promise<void> = new Promise((resolve) => {
    ws.onopen = () => {
      console.log(`Connected to RPC Web Socket (${endpoint})`)
      resolve()
    }
  })

  const send = async (message: Omit<RPCMessage, 'id'>) => {
    await connected

    const id = Math.floor(Math.random() * 65546)
    const messageWithID = { ...message, id }

    return new Promise((resolve, reject) => {
      const cb = (event: RPCMessage) => {
        try {
          if (event.id === id) {
            off(cb)
            resolve(event)
          }
        } catch (error) {
          reject(error)
        }
      }
      on(cb)

      ws.send(JSON.stringify(messageWithID))
    })
  }

  const on = (callback: (event: RPCMessage) => void) => {
    onMessageCallbacks.push(callback)
  }
  const off = (callback: (event: RPCMessage) => void) => {
    onMessageCallbacks = onMessageCallbacks.filter((cb) => cb !== callback)
  }

  return { send, on, off }
}
