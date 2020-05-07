jest.mock('../window')
jest.mock('simple-peer')
jest.useFakeTimers()

import * as PeerActions from './PeerActions'
import { TextMessage } from './PeerActions'
import Peer from 'simple-peer'
import { EventEmitter } from 'events'
import { createStore, Store, GetState } from '../store'
import { Dispatch } from 'redux'
import { ClientSocket } from '../socket'
import { PEERCALLS, PEER_EVENT_DATA, HANG_UP } from '../constants'
import { Encoder } from '../codec'
import { TextEncoder } from '../textcodec'
import { userId } from '../window'

describe('PeerActions', () => {
  function createSocket () {
    const socket = new EventEmitter() as unknown as ClientSocket
    return socket
  }

  let socket: ClientSocket
  let stream: MediaStream
  let user: { id: string }
  let store: Store
  let instances: Peer.Instance[]
  let dispatch: Dispatch
  let getState: GetState
  let PeerMock: jest.Mock<Peer.Instance>

  beforeEach(() => {
    store = createStore()
    dispatch = store.dispatch
    getState = store.getState

    user = { id: 'user1' }
    socket = createSocket()
    instances = (Peer as any).instances = [];
    (Peer as unknown as jest.Mock).mockClear()
    stream = { stream: true } as unknown as MediaStream
    PeerMock = Peer as unknown as jest.Mock<Peer.Instance>
  })

  describe('create', () => {
    it('creates a new peer', () => {
      PeerActions.createPeer({ socket, user, initiator: false, stream })(
        dispatch, getState)

      expect(instances.length).toBe(1)
      expect(PeerMock.mock.calls.length).toBe(1)
      expect(PeerMock.mock.calls[0][0].initiator).toBe(false)
      expect(PeerMock.mock.calls[0][0].stream).toBe(stream)
    })

    it('sets initiator correctly', () => {
      PeerActions
      .createPeer({
        socket, user, initiator: true, stream,
      })(dispatch, getState)

      expect(instances.length).toBe(1)
      expect(PeerMock.mock.calls.length).toBe(1)
      expect(PeerMock.mock.calls[0][0].initiator).toBe(true)
      expect(PeerMock.mock.calls[0][0].stream).toBe(stream)
    })

    it('destroys old peer before creating new one', () => {
      PeerActions.createPeer({ socket, user, initiator: false, stream })(
        dispatch, getState)
      PeerActions.createPeer({ socket, user, initiator: true, stream })(
        dispatch, getState)

      expect(instances.length).toBe(2)
      expect(PeerMock.mock.calls.length).toBe(2)
      expect((instances[0].destroy as jest.Mock).mock.calls.length).toBe(1)
      expect((instances[1].destroy as jest.Mock).mock.calls.length).toBe(0)
    })
  })

  describe('events', () => {
    function createPeer() {
      PeerActions.createPeer({ socket, user, initiator: true, stream })(
        dispatch, getState)
      const peer = instances[instances.length - 1]
      return peer
    }

    describe('connect', () => {
      it('dispatches peer connection established message', () => {
        createPeer().emit('connect')
        // TODO
      })
    })

    describe('data', () => {

      it('decodes a message', () => {
        const peer = createPeer()
        const message = {
          type: 'text',
          payload: 'test',
        }
        const chunks = new Encoder().encode({
          senderId: user.id,
          data: new TextEncoder().encode(JSON.stringify(message)),
        })
        expect(chunks.length).toBe(1)
        peer.emit('data', chunks[0])
        const { list } = store.getState().messages
        expect(list.length).toBeGreaterThan(0)
        expect(list[list.length - 1]).toEqual({
          userId: user.id,
          timestamp: jasmine.any(String),
          image: undefined,
          message: 'test',
        })
      })
    })
  })

  describe('get', () => {
    it('returns undefined when not found', () => {
      const { peers } = store.getState()
      expect(peers[user.id]).not.toBeDefined()
    })

    it('returns Peer instance when found', () => {
      PeerActions.createPeer({ socket, user, initiator: false, stream })(
        dispatch, getState)

      const { peers } = store.getState()
      expect(peers[user.id]).toBe(instances[0])
    })
  })

  describe('destroyPeers', () => {
    it('destroys all peers and removes them', () => {
      PeerActions.createPeer({
        socket, user: { id: 'user2' }, initiator: true, stream,
      })(dispatch, getState)
      PeerActions.createPeer({
        socket, user: { id: 'user3' }, initiator: false, stream,
      })(dispatch, getState)

      store.dispatch({
        type: HANG_UP,
      })

      jest.runAllTimers()

      expect((instances[0].destroy as jest.Mock).mock.calls.length).toEqual(1)
      expect((instances[1].destroy as jest.Mock).mock.calls.length).toEqual(1)

      const { peers } = store.getState()
      expect(Object.keys(peers)).toEqual([])
    })
  })

  describe('sendMessage', () => {

    beforeEach(() => {
      PeerActions.createPeer({
        socket, user: { id: 'user2' }, initiator: true, stream,
      })(dispatch, getState)
      PeerActions.createPeer({
        socket, user: { id: 'user3' }, initiator: true, stream,
      })(dispatch, getState)
    })

    it('sends a text message to all peers', () => {
      const message: TextMessage = { payload: 'test', type: 'text' }
      const chunks = new Encoder().encode({
        senderId: userId,
        data: new TextEncoder().encode(JSON.stringify(message)),
      })
      expect(chunks.length).toBe(1)
      PeerActions.sendMessage(message)(dispatch, getState)
      const { peers } = store.getState()
      expect((peers['user2'].send as jest.Mock).mock.calls)
      .toEqual([[ chunks[0] ]])
      expect((peers['user3'].send as jest.Mock).mock.calls)
      .toEqual([[ chunks[0] ]])
    })

  })

  describe('receive message (handleData)', () => {
    let peer: Peer.Instance
    function emitData(message: PeerActions.Message) {
      const chunks = new Encoder().encode({
        senderId: 'user2',
        data: new TextEncoder().encode(JSON.stringify(message)),
      })
      chunks.forEach(chunk => {
        peer.emit(PEER_EVENT_DATA, chunk)
      })
    }
    beforeEach(() => {
      PeerActions.createPeer({
        socket, user: { id: 'user2' }, initiator: true, stream,
      })(dispatch, getState)
      peer = store.getState().peers['user2']
    })

    it('handles a message', () => {
      emitData({
        payload: 'hello',
        type: 'text',
      })
      expect(store.getState().messages.list)
      .toEqual([{
        message: 'Connecting to peer...',
        userId: PEERCALLS,
        system: true,
        timestamp: jasmine.any(String),
      }, {
        message: 'hello',
        userId: 'user2',
        image: undefined,
        timestamp: jasmine.any(String),
      }])
    })

  })
})
