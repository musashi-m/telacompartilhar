const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const mediasoup = require('mediasoup');
const config = require('./config');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Servir arquivos estáticos do diretório public
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API REST informativa
app.get('/api/status', (req, res) => {
  const roomsSummary = Array.from(rooms.values()).map(r => ({
    id: r.id,
    topic: r.topic,
    peersCount: r.peers.size,
    producersCount: r.producers.size,
    hasActiveStream: Array.from(r.producers.values()).some(p => p.appData && p.appData.mediaType === 'screen-video')
  }));

  res.json({
    status: 'online',
    mediasoupVersion: mediasoup.version,
    activeRooms: roomsSummary.length,
    rooms: roomsSummary
  });
});

// Estrutura de gerenciamento mediasoup SFU
let mediasoupWorker = null;
const rooms = new Map(); // roomId -> Room object

/**
 * Inicializa o Worker mediasoup
 */
async function startMediasoup() {
  try {
    mediasoupWorker = await mediasoup.createWorker(config.mediasoup.workerSettings);
    console.log(`[SFU] mediasoup Worker iniciado com sucesso. PID: ${mediasoupWorker.pid}`);

    mediasoupWorker.on('died', (error) => {
      console.error('[SFU] CRÍTICO: mediasoup Worker morreu:', error);
      setTimeout(() => process.exit(1), 2000);
    });
  } catch (err) {
    console.error('[SFU] Falha ao iniciar worker mediasoup:', err);
    process.exit(1);
  }
}

/**
 * Obtém ou cria uma sala com seu Router SFU
 */
async function getOrCreateRoom(roomId, topic = 'Instrução Operacional', creatorPeerId = null) {
  let room = rooms.get(roomId);
  if (room) {
    return room;
  }

  console.log(`[SFU] Criando nova sala com SFU Router: "${roomId}" ("${topic}") por criador "${creatorPeerId}"`);
  const router = await mediasoupWorker.createRouter(config.mediasoup.routerOptions);

  room = {
    id: roomId,
    topic: topic,
    createdAt: Date.now(),
    creatorPeerId: creatorPeerId,
    router,
    peers: new Map(),     // peerId -> Peer
    producers: new Map()  // producerId -> { id, kind, appData, peerId, producerInstance }
  };

  rooms.set(roomId, room);
  return room;
}

/**
 * Cria WebRtcTransport no Router da sala
 */
async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport({
    ...config.mediasoup.webRtcTransportOptions,
    iceServers: config.iceServers
  });

  return transport;
}

/**
 * Broadcast para peers da mesma sala (exceto o remetente opcional)
 */
function broadcastToRoom(room, message, excludePeerId = null) {
  const data = JSON.stringify(message);
  for (const [pId, peer] of room.peers.entries()) {
    if (excludePeerId && pId === excludePeerId) continue;
    if (peer.ws && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(data);
    }
  }
}

// Gerenciamento de conexões WebSocket
wss.on('connection', (ws) => {
  let currentPeerId = null;
  let currentRoomId = null;

  const sendResponse = (id, result, error = null) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'response', id, result, error }));
    }
  };

  const sendNotification = (notification) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'notification', ...notification }));
    }
  };

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.error('[WS] Erro ao decodificar JSON:', e);
      return;
    }

    const { type, id, data } = msg;

    try {
      switch (type) {
        // Lista de salas reais abertas
        case 'getRooms': {
          const list = Array.from(rooms.values()).map(r => ({
            id: r.id,
            topic: r.topic,
            createdAt: r.createdAt,
            peersCount: r.peers.size,
            hasActiveStream: Array.from(r.producers.values()).some(p => p.appData && p.appData.mediaType === 'screen-video')
          }));
          sendResponse(id, { rooms: list });
          break;
        }

        // Entrar ou criar sala
        case 'join': {
          const { roomId, peerId, displayName, isCreating, topic } = data;
          currentRoomId = roomId;
          currentPeerId = peerId;

          // Se a sala não existe, o primeiro peer que a criar torna-se o criador/host
          const isRoomNew = !rooms.has(roomId);
          const room = await getOrCreateRoom(roomId, topic, (isCreating || isRoomNew) ? peerId : null);

          // O criador da sala é o host; todos os demais são espectadores
          const isHost = (room.creatorPeerId === peerId) || (isCreating && isRoomNew);
          if (isHost && !room.creatorPeerId) {
            room.creatorPeerId = peerId;
          }
          const assignedRole = isHost ? 'host' : 'spectator';

          // Cria ou atualiza peer
          const peer = {
            id: peerId,
            displayName: displayName || `Operador-${peerId.substring(0, 4)}`,
            role: assignedRole,
            ws,
            transports: new Map(), // transportId -> transport
            producers: new Map(),  // producerId -> producer
            consumers: new Map()   // consumerId -> consumer
          };

          room.peers.set(peerId, peer);

          console.log(`[Sala ${roomId}] Peer conectado: "${peer.displayName}" (${peerId}) como [${peer.role}] - Total: ${room.peers.size}`);

          // Notifica os outros membros da sala sobre o novo participante real
          broadcastToRoom(room, {
            event: 'peerJoined',
            peer: {
              id: peer.id,
              displayName: peer.displayName,
              role: peer.role
            }
          }, peerId);

          // Prepara lista de produtores existentes na sala para consumo imediato
          const existingProducers = Array.from(room.producers.values()).map(p => ({
            id: p.id,
            peerId: p.peerId,
            kind: p.kind,
            appData: p.appData
          }));

          const existingPeers = Array.from(room.peers.values()).map(p => ({
            id: p.id,
            displayName: p.displayName,
            role: p.role
          }));

          sendResponse(id, {
            roomId: room.id,
            topic: room.topic,
            routerRtpCapabilities: room.router.rtpCapabilities,
            iceServers: config.iceServers,
            isHost: isHost,
            role: assignedRole,
            creatorPeerId: room.creatorPeerId,
            peers: existingPeers,
            producers: existingProducers
          });
          break;
        }

        // Criar WebRtcTransport (para envio ou recepção)
        case 'createWebRtcTransport': {
          if (!currentRoomId || !rooms.has(currentRoomId)) {
            throw new Error('Sala não encontrada.');
          }

          const room = rooms.get(currentRoomId);
          const peer = room.peers.get(currentPeerId);
          if (!peer) throw new Error('Peer não registrado.');

          const transport = await createWebRtcTransport(room.router);
          peer.transports.set(transport.id, transport);

          // Tratar fechamento do transporte
          transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'failed' || dtlsState === 'closed') {
              console.warn(`[Transport ${transport.id}] DTLS State: ${dtlsState}`);
            }
          });

          sendResponse(id, {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters
          });
          break;
        }

        // Conectar WebRtcTransport com parâmetros DTLS do cliente
        case 'connectWebRtcTransport': {
          const { transportId, dtlsParameters } = data;
          const room = rooms.get(currentRoomId);
          if (!room) throw new Error('Sala não encontrada.');
          const peer = room.peers.get(currentPeerId);
          const transport = peer ? peer.transports.get(transportId) : null;
          if (!transport) throw new Error(`Transport ${transportId} não encontrado.`);

          await transport.connect({ dtlsParameters });
          sendResponse(id, { connected: true });
          break;
        }

        // Iniciar produção de mídia (tela, áudio do sistema, microfone, câmera)
        case 'produce': {
          const { transportId, kind, rtpParameters, appData } = data;
          const room = rooms.get(currentRoomId);
          if (!room) throw new Error('Sala não encontrada.');
          const peer = room.peers.get(currentPeerId);
          if (!peer) throw new Error('Peer não registrado.');

          // VALIDAÇÃO ESTRITA DE PERMISSÃO: Somente o criador/host pode transmitir tela, microfone ou câmera
          if (peer.role !== 'host' && peer.id !== room.creatorPeerId) {
            throw new Error('Permissão negada: Somente o criador/instrutor da sala pode compartilhar tela, câmera ou microfone.');
          }

          const transport = peer.transports.get(transportId);
          if (!transport) throw new Error(`Transport ${transportId} não encontrado.`);

          // Criar producer no mediasoup SFU
          const producer = await transport.produce({
            kind,
            rtpParameters,
            appData: appData || {}
          });

          peer.producers.set(producer.id, producer);
          room.producers.set(producer.id, {
            id: producer.id,
            kind: producer.kind,
            appData: producer.appData,
            peerId: currentPeerId,
            producerInstance: producer
          });

          console.log(`[SFU] Producer criado: ID ${producer.id} [${kind}] Tipo: ${appData?.mediaType || 'mídia'} por "${peer.displayName}"`);

          producer.on('transportclose', () => {
            console.log(`[Producer ${producer.id}] Transport fechado.`);
            producer.close();
            peer.producers.delete(producer.id);
            room.producers.delete(producer.id);
            broadcastToRoom(room, {
              event: 'producerClosed',
              producerId: producer.id,
              peerId: currentPeerId
            });
          });

          // Notifica todos os outros participantes sobre o novo stream disponível
          broadcastToRoom(room, {
            event: 'newProducer',
            producer: {
              id: producer.id,
              peerId: currentPeerId,
              kind: producer.kind,
              appData: producer.appData
            }
          }, currentPeerId);

          sendResponse(id, { id: producer.id });
          break;
        }

        // Consumir mídia de um produtor
        case 'consume': {
          const { producerId, rtpCapabilities } = data;
          const room = rooms.get(currentRoomId);
          if (!room) throw new Error('Sala não encontrada.');
          const peer = room.peers.get(currentPeerId);
          if (!peer) throw new Error('Peer não registrado.');

          const producerEntry = room.producers.get(producerId);
          if (!producerEntry) throw new Error(`Producer ${producerId} não encontrado na sala.`);

          // Verifica se o cliente suporta decodificar os codecs desse router
          if (!room.router.canConsume({ producerId, rtpCapabilities })) {
            throw new Error(`Incompatibilidade RTP Capabilities para o producer ${producerId}`);
          }

          // Encontra o recvTransport do peer
          let recvTransport = null;
          for (const t of peer.transports.values()) {
            if (t.appData && t.appData.direction === 'recv') {
              recvTransport = t;
              break;
            }
          }
          // Caso não tenha appData explícito, pega qualquer transporte disponível que não seja o de envio principal
          if (!recvTransport && peer.transports.size > 0) {
            recvTransport = Array.from(peer.transports.values())[0];
          }

          if (!recvTransport) {
            throw new Error('Nenhum transporte WebRTC disponível para consumo.');
          }

          // Criar Consumer no mediasoup SFU com pausa inicial para garantir handshake
          const consumer = await recvTransport.consume({
            producerId,
            rtpCapabilities,
            paused: true,
            appData: producerEntry.appData
          });

          peer.consumers.set(consumer.id, consumer);

          consumer.on('transportclose', () => {
            consumer.close();
            peer.consumers.delete(consumer.id);
          });

          consumer.on('producerclose', () => {
            consumer.close();
            peer.consumers.delete(consumer.id);
            sendNotification({
              event: 'consumerClosed',
              consumerId: consumer.id,
              producerId
            });
          });

          sendResponse(id, {
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            type: consumer.type,
            appData: consumer.appData
          });
          break;
        }

        // Retomar fluxo do consumer após conectar
        case 'resumeConsumer': {
          const { consumerId } = data;
          const room = rooms.get(currentRoomId);
          const peer = room ? room.peers.get(currentPeerId) : null;
          const consumer = peer ? peer.consumers.get(consumerId) : null;
          if (consumer) {
            await consumer.resume();
            sendResponse(id, { resumed: true });
          } else {
            sendResponse(id, { resumed: false });
          }
          break;
        }

        // Fechar produtor (ex: apresentador encerrou compartilhamento)
        case 'closeProducer': {
          const { producerId } = data;
          const room = rooms.get(currentRoomId);
          if (room) {
            const peer = room.peers.get(currentPeerId);
            if (peer && peer.producers.has(producerId)) {
              const prod = peer.producers.get(producerId);
              prod.close();
              peer.producers.delete(producerId);
              room.producers.delete(producerId);

              broadcastToRoom(room, {
                event: 'producerClosed',
                producerId,
                peerId: currentPeerId
              });
            }
          }
          sendResponse(id, { closed: true });
          break;
        }

        // Mensagens de texto / perguntas no canal de Q&A / Chat
        case 'chatMessage': {
          const room = rooms.get(currentRoomId);
          if (room) {
            const messageObj = {
              id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
              senderId: currentPeerId,
              senderName: data.senderName || 'Participante',
              text: data.text,
              type: data.messageType || 'chat', // 'chat' ou 'question'
              timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            };

            // Envia para todos na sala
            broadcastToRoom(room, {
              event: 'chatMessage',
              message: messageObj
            });
            sendResponse(id, { sent: true });
          } else {
            throw new Error('Sala não conectada.');
          }
          break;
        }

        // Sair da sala
        case 'leave': {
          cleanupPeer();
          sendResponse(id, { left: true });
          break;
        }

        default:
          console.warn(`[WS] Tipo de mensagem desconhecido: ${type}`);
          sendResponse(id, null, 'Mensagem não reconhecida');
      }
    } catch (err) {
      console.error(`[WS Error] Falha na operação "${type}":`, err.message);
      sendResponse(id, null, err.message);
    }
  });

  const cleanupPeer = () => {
    if (!currentRoomId || !currentPeerId) return;

    const room = rooms.get(currentRoomId);
    if (!room) return;

    const peer = room.peers.get(currentPeerId);
    if (!peer) return;

    console.log(`[Sala ${currentRoomId}] Limpando peer desconectado: "${peer.displayName}" (${currentPeerId})`);

    // Fecha todos os produtores do peer e notifica a sala
    for (const [prodId, prod] of peer.producers.entries()) {
      prod.close();
      room.producers.delete(prodId);
      broadcastToRoom(room, {
        event: 'producerClosed',
        producerId: prodId,
        peerId: currentPeerId
      }, currentPeerId);
    }

    // Fecha consumers e transports
    for (const consumer of peer.consumers.values()) {
      consumer.close();
    }
    for (const transport of peer.transports.values()) {
      transport.close();
    }

    room.peers.delete(currentPeerId);

    // Notifica saída
    broadcastToRoom(room, {
      event: 'peerLeft',
      peerId: currentPeerId
    });

    // Se não sobrar ninguém, mantém a sala temporariamente para permitir reconexões rápidas
    if (room.peers.size === 0) {
      setTimeout(() => {
        const checkRoom = rooms.get(currentRoomId);
        if (checkRoom && checkRoom.peers.size === 0) {
          console.log(`[SFU] Removendo sala inativa: ${currentRoomId}`);
          checkRoom.router.close();
          rooms.delete(currentRoomId);
        }
      }, 30000);
    }

    currentRoomId = null;
    currentPeerId = null;
  };

  ws.on('close', () => {
    cleanupPeer();
  });

  ws.on('error', (err) => {
    console.error('[WS] Erro de socket:', err.message);
    cleanupPeer();
  });
});

// Inicialização
async function main() {
  await startMediasoup();

  const port = config.http.port;
  server.listen(port, config.http.host, () => {
    console.log('================================================================');
    console.log(` [PMESP STREAM] Servidor SFU mediasoup iniciado com sucesso`);
    console.log(` URL Local:     http://localhost:${port}`);
    console.log(` WebSocket:     ws://localhost:${port}`);
    console.log(` STUN Servers:  ${config.iceServers.map(s => s.urls).join(', ')}`);
    console.log('================================================================');
  });
}

main().catch(err => {
  console.error('Falha fatal na inicialização do servidor:', err);
  process.exit(1);
});
