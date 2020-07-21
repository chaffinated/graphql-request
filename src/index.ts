import fetch from 'cross-fetch'
import { ClientError, GraphQLError, Variables, GraphQLSubscriptionObserver } from './types'
import { Request, RequestInit, Response } from './types.dom'

export { ClientError, GraphQLSubscriptionObserver } from './types'

const NativeWebSocket = window.WebSocket;
const GQL_WS = {
  CONNECTION_INIT: 'connection_init',
  CONNECTION_ACK: 'connection_ack',
  CONNECTION_ERROR: 'connection_error',
  CONNECTION_KEEP_ALIVE: 'ka',
  START: 'start',
  STOP: 'stop',
  CONNECTION_TERMINATE: 'connection_terminate',
  DATA: 'data',
  ERROR: 'error',
  COMPLETE: 'complete'
};


export class GraphQLClient {
  private url: string
  private options: RequestInit

  constructor(url: string, options?: RequestInit) {
    this.url = url
    this.options = options || {}
  }

  async rawRequest<T = any>(
    query: string,
    variables?: Variables
  ): Promise<{
    data?: T
    extensions?: any
    headers: Request['headers']
    status: number
    errors?: GraphQLError[]
  }> {
    const { headers, ...others } = this.options

    const body = JSON.stringify({
      query,
      variables: variables ? variables : undefined,
    })

    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      ...others,
    })

    const result = await getResult(response)

    if (response.ok && !result.errors && result.data) {
      const { headers, status } = response
      return { ...result, headers, status }
    } else {
      const errorResult = typeof result === 'string' ? { error: result } : result
      throw new ClientError(
        { ...errorResult, status: response.status, headers: response.headers },
        { query, variables }
      )
    }
  }

  async request<T = any>(query: string, variables?: Variables): Promise<T> {
    const { headers, ...others } = this.options

    const body = JSON.stringify({
      query,
      variables: variables ? variables : undefined,
    })

    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      ...others,
    })

    const result = await getResult(response)

    if (response.ok && !result.errors && result.data) {
      return result.data
    } else {
      const errorResult = typeof result === 'string' ? { error: result } : result
      throw new ClientError({ ...errorResult, status: response.status }, { query, variables })
    }
  }

  subscribe<T = any>(query: string, variables: Variables = {}, observer: GraphQLSubscriptionObserver<T>): () => void {
    const url = this.url.replace(/^https?/, 'ws');
    const { headers } = this.options;
    const context = { ...headers };
    const requestData = { query, variables, context };
    let id: number | string | null = null;
    const ws = new NativeWebSocket(url, 'graphql-ws');

    ws.addEventListener('open', () => {
      const initRequest = JSON.stringify({
        type: GQL_WS.CONNECTION_INIT,
        payload: this.options,
      });
      ws.send(initRequest);
    });

    ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);
      switch (data.type) {
        case GQL_WS.CONNECTION_ACK:
          id = data.id;
          const startRequest = JSON.stringify({
            id,
            type: GQL_WS.START,
            payload: requestData,
          });
          ws.send(startRequest)
          return;
        case GQL_WS.CONNECTION_ERROR:
          console.warn('[graphql-request]: connection error', data);
          observer.error(data.error);
          return;
        case GQL_WS.CONNECTION_KEEP_ALIVE:
          return;
        case GQL_WS.DATA:
          observer.next(data.payload);
          return;
        case GQL_WS.STOP:
          const terminateRequest = JSON.stringify({
            type: GQL_WS.CONNECTION_TERMINATE,
          });
          ws.send(terminateRequest);
          return;
        case GQL_WS.CONNECTION_TERMINATE:
          ws.close();
          return;
        case GQL_WS.COMPLETE:
          observer.complete();
          ws.close();
          return;
      }
    });

    // ws.addEventListener('close', () => observer.complete());

    return () => {
      const closeRequest = JSON.stringify({
        id,
        type: GQL_WS.STOP,
      });
      ws.send(closeRequest);
    };
  }

  setHeaders(headers: Response['headers']): GraphQLClient {
    this.options.headers = headers

    return this
  }

  setHeader(key: string, value: string): GraphQLClient {
    const { headers } = this.options

    if (headers) {
      // todo what if headers is in nested array form... ?
      //@ts-ignore
      headers[key] = value
    } else {
      this.options.headers = { [key]: value }
    }
    return this
  }
}

export function rawRequest<T = any>(
  url: string,
  query: string,
  variables?: Variables
): Promise<{
  data?: T
  extensions?: any
  headers: Request['headers']
  status: number
  errors?: GraphQLError[]
}> {
  const client = new GraphQLClient(url)

  return client.rawRequest<T>(query, variables)
}

export function request<T = any>(url: string, query: string, variables?: Variables): Promise<T> {
  const client = new GraphQLClient(url)
  return client.request<T>(query, variables)
}

export function subscribe<T = any>(url: string, query: string, variables: Variables = {}, observer: GraphQLSubscriptionObserver<T>): () => void {
  const client = new GraphQLClient(url)
  return client.subscribe<T>(query, variables, observer);
}

export default request

function getResult(response: Response): Promise<any> {
  const contentType = response.headers.get('Content-Type')
  if (contentType && contentType.startsWith('application/json')) {
    return response.json()
  } else {
    return response.text()
  }
}
