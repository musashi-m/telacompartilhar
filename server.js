const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Desativar cache para garantir que atualizações do frontend cheguem imediatamente
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Servir arquivos estáticos do diretório public
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0
}));
app.use(express.json());

// Estrutura de salas
const rooms = new Map(); // roomId -> Room

// API REST informativa
app.get('/api/status', (req, res) => {
  const roomsSummary = Array.from(rooms.values()).map(r => ({
    id: r.id,
    topic: r.topic,
    peersCount: r.peers.size,
    hasActiveStream: r.hasActiveStream,
    hasPassword: !!r.password
  }));

  res.json({
    status: 'online',
    transport: 'WebRTC P2P',
    activeRooms: roomsSummary.length,
    rooms: roomsSummary
  });
});

// Informações públicas da sala para entrada
app.get('/api/room/:id', (req, res) => {
  const cleanId = String(req.params.id || '').trim().toUpperCase();
  const r = rooms.get(cleanId);
  if (!r) {
    return res.status(404).json({ exists: false });
  }
  res.json({
    exists: true,
    id: r.id,
    topic: r.topic,
    hasPassword: !!r.password,
    hasActiveStream: r.hasActiveStream,
    peersCount: r.peers.size
  });
});

// Fallback para SPA: qualquer requisição GET não-API entrega index.html
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

/**
 * Envia mensagem para um peer específico na sala
 */
function sendToPeer(room, targetPeerId, message) {
  const peer = room.peers.get(targetPeerId);
  if (peer && peer.ws && peer.ws.readyState === WebSocket.OPEN) {
    peer.ws.send(JSON.stringify(message));
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
            hasActiveStream: r.hasActiveStream,
            hasPassword: !!r.password
          }));
          sendResponse(id, { rooms: list });
          break;
        }

        // Consulta status da sala (se existe e se tem senha)
        case 'getRoomInfo': {
          const { roomId } = data;
          const cleanId = String(roomId || '').trim().toUpperCase();
          const r = rooms.get(cleanId);
          if (!r) {
            sendResponse(id, { exists: false });
          } else {
            sendResponse(id, {
              exists: true,
              id: r.id,
              topic: r.topic,
              hasPassword: !!r.password,
              hasActiveStream: r.hasActiveStream,
              peersCount: r.peers.size
            });
          }
          break;
        }

        // Entrar ou criar sala
        case 'join': {
          const { roomId, peerId, displayName, isCreating, topic, password, hostToken } = data;
          const cleanRoomId = String(roomId || '').trim().toUpperCase();
          currentRoomId = cleanRoomId;
          currentPeerId = peerId;

          const isRoomNew = !rooms.has(cleanRoomId);
          let room;

          if (isRoomNew) {
            const cleanPin = (password && String(password).trim().length === 4) ? String(password).trim() : null;
            const generatedHostToken = 'ht-' + Math.random().toString(36).substring(2, 12);
            room = {
              id: cleanRoomId,
              topic: topic || 'Instrução Operacional',
              createdAt: Date.now(),
              creatorPeerId: peerId,
              hostToken: generatedHostToken,
              password: cleanPin,
              peers: new Map(),
              hasActiveStream: false
            };
            rooms.set(cleanRoomId, room);
            console.log(`[Sala ${cleanRoomId}] Nova sala criada por "${displayName}" (${peerId})${room.password ? ' [PROTEGIDA POR SENHA]' : ''}`);
          } else {
            room = rooms.get(cleanRoomId);

            // Validação de Host persistente (se possuir o hostToken emitido na criação ou mesmo peerId)
            const isHostAttempt = Boolean(
              (hostToken && room.hostToken && hostToken === room.hostToken) ||
              (room.creatorPeerId === peerId)
            );

            // Validação de Senha (se a sala for protegida e quem está entrando NÃO for o instrutor)
            if (room.password && !isHostAttempt) {
              const providedPin = password ? String(password).trim() : '';
              if (!providedPin) {
                return sendResponse(id, null, 'SENHA_OBRIGATORIA');
              }
              if (providedPin !== room.password) {
                return sendResponse(id, null, 'SENHA_INCORRETA');
              }
            }

            if (isHostAttempt) {
              // Reatribui o criador ao peerId atual do instrutor após recarregar a página
              room.creatorPeerId = peerId;
            }
          }

          const isHost = Boolean(
            (room.creatorPeerId === peerId) ||
            (hostToken && room.hostToken && hostToken === room.hostToken) ||
            (isCreating && isRoomNew)
          );
          if (isHost && !room.creatorPeerId) {
            room.creatorPeerId = peerId;
          }
          const assignedRole = isHost ? 'host' : 'spectator';

          // Se este mesmo peer já estava registrado com outro WebSocket (reconexão rápida),
          // desassocia o socket antigo para evitar que o fechamento dele dispare limpeza
          const existingPeer = room.peers.get(peerId);
          if (existingPeer && existingPeer.ws && existingPeer.ws !== ws) {
            console.log(`[Sala ${cleanRoomId}] Substituindo conexão antiga de "${displayName}" (${peerId})`);
            try {
              existingPeer.ws.close();
            } catch (e) {}
          }

          const peer = {
            id: peerId,
            displayName: displayName || `Operador-${peerId.substring(0, 4)}`,
            role: assignedRole,
            ws
          };

          room.peers.set(peerId, peer);

          console.log(`[Sala ${cleanRoomId}] Peer conectado: "${peer.displayName}" (${peerId}) como [${peer.role}] - Total: ${room.peers.size}`);

          // Notifica os outros membros da sala sobre o novo participante
          broadcastToRoom(room, {
            type: 'notification',
            event: 'peerJoined',
            peer: {
              id: peer.id,
              displayName: peer.displayName,
              role: peer.role
            }
          }, peerId);

          const existingPeers = Array.from(room.peers.values()).map(p => ({
            id: p.id,
            displayName: p.displayName,
            role: p.role
          }));

          // Configuração de ICE servers otimizada para conexão rápida e sem sobrecarga
          const iceServers = [
            { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
            { urls: ['stun:stun.cloudflare.com:3478'] }
          ];

          sendResponse(id, {
            roomId: room.id,
            topic: room.topic,
            isHost,
            role: assignedRole,
            creatorPeerId: room.creatorPeerId,
            hostToken: isHost ? room.hostToken : null,
            peers: existingPeers,
            hasActiveStream: room.hasActiveStream,
            hasPassword: !!room.password,
            iceServers
          });
          break;
        }

        // Sinalização WebRTC P2P: Offer
        case 'rtcOffer': {
          const { targetPeerId, offer } = data;
          const room = rooms.get(currentRoomId);
          if (!room) throw new Error('Sala não encontrada.');

          sendToPeer(room, targetPeerId, {
            type: 'notification',
            event: 'rtcOffer',
            fromPeerId: currentPeerId,
            offer
          });
          sendResponse(id, { sent: true });
          break;
        }

        // Sinalização WebRTC P2P: Answer
        case 'rtcAnswer': {
          const { targetPeerId, answer } = data;
          const room = rooms.get(currentRoomId);
          if (!room) throw new Error('Sala não encontrada.');

          sendToPeer(room, targetPeerId, {
            type: 'notification',
            event: 'rtcAnswer',
            fromPeerId: currentPeerId,
            answer
          });
          sendResponse(id, { sent: true });
          break;
        }

        // Sinalização WebRTC P2P: ICE Candidate
        case 'rtcIceCandidate': {
          const { targetPeerId, candidate } = data;
          const room = rooms.get(currentRoomId);
          if (!room) throw new Error('Sala não encontrada.');

          sendToPeer(room, targetPeerId, {
            type: 'notification',
            event: 'rtcIceCandidate',
            fromPeerId: currentPeerId,
            candidate
          });
          // Sem response para ICE candidates (fire-and-forget)
          break;
        }

        // Host notifica que iniciou transmissão
        case 'streamStarted': {
          const room = rooms.get(currentRoomId);
          if (!room) throw new Error('Sala não encontrada.');
          room.hasActiveStream = true;

          broadcastToRoom(room, {
            type: 'notification',
            event: 'streamStarted',
            hostPeerId: currentPeerId,
            streamInfo: data.streamInfo || {}
          }, currentPeerId);

          sendResponse(id, { ok: true });
          break;
        }

        // Host notifica que encerrou transmissão
        case 'streamStopped': {
          const room = rooms.get(currentRoomId);
          if (!room) throw new Error('Sala não encontrada.');
          room.hasActiveStream = false;

          broadcastToRoom(room, {
            type: 'notification',
            event: 'streamStopped',
            hostPeerId: currentPeerId
          }, currentPeerId);

          sendResponse(id, { ok: true });
          break;
        }

        // Espectador solicita stream do host
        case 'requestStream': {
          const room = rooms.get(currentRoomId);
          if (!room) throw new Error('Sala não encontrada.');

          // Envia notificação para o host
          sendToPeer(room, room.creatorPeerId, {
            type: 'notification',
            event: 'viewerRequestsStream',
            viewerPeerId: currentPeerId
          });

          sendResponse(id, { requested: true });
          break;
        }

        // Espectador solicita keyframe imediato (IDR frame) para sincronização instantânea
        case 'requestKeyframe': {
          const { targetPeerId } = data;
          const room = rooms.get(currentRoomId);
          if (room) {
            sendToPeer(room, targetPeerId || room.creatorPeerId, {
              type: 'notification',
              event: 'keyframeRequested',
              fromPeerId: currentPeerId
            });
          }
          break;
        }

        // Mensagens de texto / Chat
        case 'chatMessage': {
          const room = rooms.get(currentRoomId);
          if (room) {
            const messageObj = {
              id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
              senderId: currentPeerId,
              senderName: data.senderName || 'Participante',
              text: data.text,
              type: data.messageType || 'chat',
              timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            };

            broadcastToRoom(room, {
              type: 'notification',
              event: 'chatMessage',
              message: messageObj
            });
            sendResponse(id, { sent: true });
          } else {
            throw new Error('Sala não conectada.');
          }
          break;
        }

        // Sair da sala individualmente
        case 'leave': {
          cleanupPeer();
          sendResponse(id, { left: true });
          break;
        }

        // Encerrar aula definitivamente (apenas o instrutor)
        case 'endRoom': {
          const room = rooms.get(currentRoomId);
          if (!room) throw new Error('Sala não encontrada.');

          if (room.creatorPeerId !== currentPeerId) {
            throw new Error('Apenas o instrutor possui autorização para encerrar a aula.');
          }

          console.log(`[Sala ${currentRoomId}] Instrução encerrada em definitivo pelo instrutor (${currentPeerId}). Fechando para todos.`);

          // Notifica todos os participantes que a aula acabou e a sala foi fechada
          broadcastToRoom(room, {
            type: 'notification',
            event: 'roomClosed',
            reason: 'A aula de instrução foi encerrada em definitivo pelo instrutor.'
          });

          // Deleta a sala do servidor imediatamente
          const closingRoomId = currentRoomId;
          rooms.delete(closingRoomId);
          currentRoomId = null;

          sendResponse(id, { ended: true, roomId: closingRoomId });
          break;
        }

        // Consulta lista atualizada de participantes da sala
        case 'getRoomPeers': {
          const room = rooms.get(currentRoomId);
          if (!room) throw new Error('Sala não encontrada.');
          const list = Array.from(room.peers.values()).map(p => ({
            id: p.id,
            displayName: p.displayName,
            role: p.role
          }));
          sendResponse(id, { peers: list });
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

    // Proteção crucial contra race condition no reload (F5):
    // Se o peer na sala já estiver associado a uma nova conexão WebSocket,
    // o fechamento deste socket antigo NÃO deve remover o peer nem enviar peerLeft!
    if (peer.ws !== ws) {
      console.log(`[Sala ${currentRoomId}] Conexão anterior de "${peer.displayName}" (${currentPeerId}) fechada, mas peer já ativo em novo socket.`);
      return;
    }

    console.log(`[Sala ${currentRoomId}] Peer desconectado: "${peer.displayName}" (${currentPeerId})`);

    // Se o host desconectou, marca stream como inativo
    if (currentPeerId === room.creatorPeerId) {
      room.hasActiveStream = false;
    }

    room.peers.delete(currentPeerId);

    // Notifica saída
    broadcastToRoom(room, {
      type: 'notification',
      event: 'peerLeft',
      peerId: currentPeerId
    });

    const roomToClean = currentRoomId;
    // Se não sobrar ninguém, remove a sala após 60s de tolerância para reload/reconexão
    if (room.peers.size === 0) {
      setTimeout(() => {
        const checkRoom = rooms.get(roomToClean);
        if (checkRoom && checkRoom.peers.size === 0) {
          console.log(`[Sala] Removendo sala inativa após tolerância: ${roomToClean}`);
          rooms.delete(roomToClean);
        }
      }, 60000);
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
const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log('================================================================');
  console.log(` [PMESP STREAM] Servidor de Sinalização WebRTC P2P`);
  console.log(` URL Local:     http://localhost:${port}`);
  console.log(` WebSocket:     ws://localhost:${port}`);
  console.log(` Arquitetura:   WebRTC Peer-to-Peer (sem SFU)`);
  console.log('================================================================');
});
