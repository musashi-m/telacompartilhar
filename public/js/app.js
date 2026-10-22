/**
 * PMESP STREAM - APLICAÇÃO DE COMPARTILHAMENTO DE TELA & INSTRUÇÃO WEBRTC
 * Arquitetura P2P: WebRTC nativo com RTCPeerConnection e sinalização WebSocket
 * Sem dependência de mediasoup ou qualquer biblioteca SFU externa.
 */

(function () {
  'use strict';

  // ========================================================================
  // ESTADO DA APLICAÇÃO
  // ========================================================================
  const state = {
    ws: null,
    connected: false,
    requestId: 0,
    pendingRequests: new Map(),

    // Identificação do Usuário Local Persistente (sobrevive a F5 / reload)
    peerId: (function() {
      let id = null;
      try { id = localStorage.getItem('pmesp_peer_id'); } catch (e) {}
      if (!id || typeof id !== 'string' || !id.startsWith('peer-')) {
        id = 'peer-' + Math.random().toString(36).substring(2, 9);
        try { localStorage.setItem('pmesp_peer_id', id); } catch (e) {}
      }
      return id;
    })(),
    displayName: (function() {
      try { return localStorage.getItem('pmesp_user_name') || 'Operador Local'; } catch (e) { return 'Operador Local'; }
    })(),
    role: 'spectator', // 'host' ou 'spectator'
    isHost: false,
    creatorPeerId: null,

    // Sala Atual
    currentRoomId: null,
    currentRoomTopic: '',
    sessionStartTime: null,
    sessionTimerInterval: null,

    // WebRTC P2P
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: ['stun:stun.cloudflare.com:3478'] }
    ],
    peerConnections: new Map(),  // peerId -> RTCPeerConnection
    pendingCandidates: new Map(), // peerId -> [candidates] (antes de remoteDescription)

    // Streams Locais
    screenStream: null,
    webcamStream: null,
    micStream: null,

    // Controle de transmissão
    isBroadcasting: false,

    // Preferências de Transmissão
    preferences: {
      preset: 'motion', // 'motion' (60 FPS jogos/vídeos) ou 'detail' (documentos/texto)
      maxResolution: '1080',
      maxFps: '60',
      systemAudio: true
    },

    // Participantes e Mensagens Reais
    peers: new Map(), // peerId -> { id, displayName, role }

    // Telemetria
    statsInterval: null,
    lastBytes: 0,
    lastStatsTimestamp: 0
  };

  // ========================================================================
  // ELEMENTOS DO DOM
  // ========================================================================
  const dom = {
    // Telas
    viewLobby: document.getElementById('view-lobby'),
    viewRoom: document.getElementById('view-room'),

    // Usuário no Header
    headerUserDisplay: document.getElementById('current-user-display'),
    headerUserRole: document.getElementById('current-user-role'),
    headerUserAvatar: document.getElementById('current-user-avatar'),

    // Lobby
    cardCreateRoom: document.getElementById('card-create-room'),
    inputCreateTopic: document.getElementById('create-topic'),
    inputCreateUsername: document.getElementById('create-username'),
    createRequirePassword: document.getElementById('create-require-password'),
    createPasswordGroup: document.getElementById('create-password-group'),
    createPassword: document.getElementById('create-password'),
    btnCreateRoom: document.getElementById('btn-create-room'),
    cardJoinRoom: document.getElementById('card-join-room'),
    joinCodeGroup: document.getElementById('join-code-group'),
    inputJoinCode: document.getElementById('join-code'),
    inputJoinUsername: document.getElementById('join-username'),
    joinPasswordGroup: document.getElementById('join-password-group'),
    joinPassword: document.getElementById('join-password'),
    btnJoinRoom: document.getElementById('btn-join-room'),
    linkShowFullLobby: document.getElementById('link-show-full-lobby'),
    btnShowCreateRoom: document.getElementById('btn-show-create-room'),
    roomsSection: document.querySelector('.rooms-section'),
    roomsListContainer: document.getElementById('rooms-list-container'),
    activeRoomsCount: document.getElementById('active-rooms-count'),
    btnRefreshRooms: document.getElementById('btn-refresh-rooms'),
    inviteBanner: document.getElementById('invite-banner'),
    inviteRoomCode: document.getElementById('invite-room-code'),
    joinCodeBadge: document.getElementById('join-code-badge'),

    // Sala Sub-header
    sessionRoomTopic: document.getElementById('session-room-topic'),
    sessionRoomId: document.getElementById('session-room-id'),
    btnCopyLink: document.getElementById('btn-copy-link'),
    copyText: document.getElementById('copy-text'),
    btnCopyInviteSidebar: document.getElementById('btn-copy-invite-sidebar'),
    copyTextSidebar: document.getElementById('copy-text-sidebar'),
    sessionTimer: document.getElementById('session-timer'),
    liveIndicator: document.getElementById('live-indicator'),
    liveText: document.getElementById('live-text'),
    sfuStatusIcon: document.getElementById('sfu-status-icon'),
    sfuStatusText: document.getElementById('sfu-status-text'),
    btnTogglePanel: document.getElementById('btn-toggle-panel'),

    // Vídeo & Stage
    remoteVideo: document.getElementById('remote-video'),
    remoteAudio: document.getElementById('remote-audio'),
    btnUnmuteAudio: document.getElementById('btn-unmute-audio'),
    placeholderStage: document.getElementById('placeholder-stage'),
    placeholderTitle: document.getElementById('placeholder-title'),
    placeholderDesc: document.getElementById('placeholder-desc'),
    placeholderIconSymbol: document.getElementById('placeholder-icon-symbol'),
    btnStageStartShare: document.getElementById('btn-stage-start-share'),
    streamInfoBadge: document.getElementById('stream-info-badge'),
    streamInfoText: document.getElementById('stream-info-text'),
    webcamPip: document.getElementById('webcam-pip'),
    localWebcam: document.getElementById('local-webcam'),

    // Controles Inferiores
    hostMediaControls: document.getElementById('host-media-controls'),
    spectatorModeBadge: document.getElementById('spectator-mode-badge'),
    btnCtrlMic: document.getElementById('btn-ctrl-mic'),
    iconCtrlMic: document.getElementById('icon-ctrl-mic'),
    labelCtrlMic: document.getElementById('label-ctrl-mic'),
    btnCtrlCam: document.getElementById('btn-ctrl-cam'),
    iconCtrlCam: document.getElementById('icon-ctrl-cam'),
    labelCtrlCam: document.getElementById('label-ctrl-cam'),
    btnCtrlScreen: document.getElementById('btn-ctrl-screen'),
    iconCtrlScreen: document.getElementById('icon-ctrl-screen'),
    labelCtrlScreen: document.getElementById('label-ctrl-screen'),
    btnCtrlSettings: document.getElementById('btn-ctrl-settings'),
    btnCtrlUsers: document.getElementById('btn-ctrl-users'),
    labelCtrlUsers: document.getElementById('label-ctrl-users'),
    btnCtrlChat: document.getElementById('btn-ctrl-chat'),
    btnCtrlStats: document.getElementById('btn-ctrl-stats'),
    btnCtrlExit: document.getElementById('btn-ctrl-exit'),
    iconCtrlExit: document.getElementById('icon-ctrl-exit'),
    labelCtrlExit: document.getElementById('label-ctrl-exit'),

    // Painel Lateral
    sidebarPanel: document.getElementById('sidebar-panel'),
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabContents: document.querySelectorAll('.tab-content'),
    peerList: document.getElementById('peer-list'),
    tabUsersCount: document.getElementById('tab-users-count'),
    chatMessagesContainer: document.getElementById('chat-messages-container'),
    chatInput: document.getElementById('chat-input'),
    btnSendChat: document.getElementById('btn-send-chat'),

    // Telemetria DOM
    statFps: document.getElementById('stat-fps'),
    statFpsTarget: document.getElementById('stat-fps-target'),
    statRes: document.getElementById('stat-res'),
    statAspect: document.getElementById('stat-aspect'),
    statBitrate: document.getElementById('stat-bitrate'),
    statRtt: document.getElementById('stat-rtt'),
    statRttStatus: document.getElementById('stat-rtt-status'),
    statPacketLoss: document.getElementById('stat-packet-loss'),
    statPacketCount: document.getElementById('stat-packet-count'),
    statJitter: document.getElementById('stat-jitter'),
    statCodec: document.getElementById('stat-codec'),
    statTransportType: document.getElementById('stat-transport-type'),

    // Modais
    modalSettings: document.getElementById('modal-settings'),
    presetCardMotion: document.getElementById('preset-card-motion'),
    presetCardDetail: document.getElementById('preset-card-detail'),
    selectResolution: document.getElementById('select-resolution'),
    selectFps: document.getElementById('select-fps'),
    checkSystemAudio: document.getElementById('check-system-audio'),
    btnModalCancel: document.getElementById('btn-modal-cancel'),
    btnModalApply: document.getElementById('btn-modal-apply'),

    modalExit: document.getElementById('modal-exit'),
    modalExitIcon: document.getElementById('modal-exit-icon'),
    modalExitTitle: document.getElementById('modal-exit-title'),
    modalExitDesc: document.getElementById('modal-exit-desc'),
    btnExitCancel: document.getElementById('btn-exit-cancel'),
    btnExitConfirm: document.getElementById('btn-exit-confirm'),

    toastContainer: document.getElementById('toast-container')
  };

  // ========================================================================
  // NOTIFICAÇÕES TOAST
  // ========================================================================
  function showToast(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'info';
    if (type === 'warn') icon = 'warning';
    if (type === 'error') icon = 'error';
    if (type === 'ok') icon = 'check_circle';

    toast.innerHTML = `
      <span class="material-symbols-outlined" style="font-size: 20px;">${icon}</span>
      <span>${message}</span>
    `;

    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ========================================================================
  // CONEXÃO WEBSOCKET & SINALIZAÇÃO
  // ========================================================================
  function connectWebSocket() {
    if (state.ws && (state.ws.readyState === WebSocket.CONNECTING || state.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}`;

    updateConnectionIndicator('connecting');

    try {
      state.ws = new WebSocket(wsUrl);
    } catch (e) {
      console.warn('[WS] Erro ao instanciar WebSocket:', e);
      setTimeout(connectWebSocket, 1500);
      return;
    }

    state.ws.onopen = () => {
      console.log('[WS] Conectado ao servidor de sinalização');
      state.connected = true;
      updateConnectionIndicator('connected');
      fetchRoomsList();
    };

    state.ws.onclose = () => {
      console.warn('[WS] Conexão encerrada. Reconectando em 1.5s...');
      state.connected = false;
      updateConnectionIndicator('disconnected');
      setTimeout(connectWebSocket, 1500);
    };

    state.ws.onerror = (err) => {
      console.error('[WS] Erro de socket:', err);
      updateConnectionIndicator('error');
    };

    state.ws.onmessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.error('[WS] Erro ao analisar mensagem JSON:', e);
        return;
      }

      // Tratar Respostas a requisições pendentes
      if (msg.type === 'response') {
        const { id, result, error } = msg;
        if (state.pendingRequests.has(id)) {
          const { resolve, reject } = state.pendingRequests.get(id);
          state.pendingRequests.delete(id);
          if (error) reject(new Error(error));
          else resolve(result);
        }
        return;
      }

      // Tratar Notificações do Servidor
      if (msg.type === 'notification') {
        handleServerNotification(msg);
      }
    };
  }

  /**
   * Garante que o WebSocket esteja pronto antes de disparar comandos
   */
  function ensureWebSocketConnected(maxWaitMs = 8000) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    // Se estiver nulo ou fechado, tenta conectar imediatamente
    if (!state.ws || state.ws.readyState === WebSocket.CLOSED || state.ws.readyState === WebSocket.CLOSING) {
      connectWebSocket();
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          clearInterval(checkInterval);
          resolve();
        } else if (Date.now() - startTime > maxWaitMs) {
          clearInterval(checkInterval);
          reject(new Error('O servidor está iniciando ou reconectando no Render. Por favor, aguarde alguns segundos e tente novamente.'));
        }
      }, 200);
    });
  }

  async function sendRequest(type, data = {}) {
    await ensureWebSocketConnected();

    return new Promise((resolve, reject) => {
      if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket não conectado.'));
      }

      const id = ++state.requestId;
      state.pendingRequests.set(id, { resolve, reject });

      state.ws.send(JSON.stringify({ type, id, data }));

      // Timeout de segurança após 15 segundos
      setTimeout(() => {
        if (state.pendingRequests.has(id)) {
          state.pendingRequests.delete(id);
          reject(new Error(`Timeout na requisição ${type}`));
        }
      }, 15000);
    });
  }

  // Envio fire-and-forget (sem aguardar resposta) para ICE candidates
  function sendSignal(type, data = {}) {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.ws.send(JSON.stringify({ type, id: ++state.requestId, data }));
  }

  // ========================================================================
  // PROCESSAMENTO DE NOTIFICAÇÕES DO SERVIDOR
  // ========================================================================
  async function handleServerNotification(notification) {
    const { event } = notification;

    switch (event) {
      // Host recebe pedido de stream de um espectador
      case 'viewerRequestsStream': {
        const { viewerPeerId } = notification;
        console.log('[P2P] Espectador solicitou stream:', viewerPeerId);
        if (state.isHost && state.isBroadcasting && state.screenStream) {
          const existingPc = state.peerConnections.get(viewerPeerId);
          if (existingPc && (existingPc.connectionState === 'connected' || existingPc.signalingState === 'have-local-offer' || existingPc.connectionState === 'connecting')) {
            console.log(`[P2P] Conexão com ${viewerPeerId} já em andamento (${existingPc.signalingState} / ${existingPc.connectionState}). Forçando keyframe imediato.`);
            forceKeyframeOnSender(viewerPeerId);
            return;
          }
          await createOfferForViewer(viewerPeerId, true);
        }
        break;
      }

      // Host recebe pedido de keyframe do espectador
      case 'keyframeRequested': {
        const { fromPeerId } = notification;
        if (state.isHost && state.isBroadcasting) {
          console.log(`[P2P] Espectador ${fromPeerId} solicitou keyframe IDR imediato`);
          forceKeyframeOnSender(fromPeerId);
        }
        break;
      }

      // Espectador recebe offer do host
      case 'rtcOffer': {
        const { fromPeerId, offer } = notification;
        console.log('[P2P] Recebeu offer de:', fromPeerId);
        await handleIncomingOffer(fromPeerId, offer);
        break;
      }

      // Host recebe answer do espectador
      case 'rtcAnswer': {
        const { fromPeerId, answer } = notification;
        console.log('[P2P] Recebeu answer de:', fromPeerId);
        await handleIncomingAnswer(fromPeerId, answer);
        break;
      }

      // Candidato ICE de qualquer peer
      case 'rtcIceCandidate': {
        const { fromPeerId, candidate } = notification;
        await handleIncomingIceCandidate(fromPeerId, candidate);
        break;
      }

      // Notificação de que o host iniciou transmissão
      case 'streamStarted': {
        const { hostPeerId, streamInfo } = notification;
        console.log('[P2P] Host iniciou transmissão:', hostPeerId);
        if (hostPeerId) {
          state.creatorPeerId = hostPeerId;
        }
        showToast('Transmissão iniciada pelo instrutor. Conectando...', 'info', 3000);
        updateConnectionIndicator('connecting');

        if (dom.placeholderTitle) {
          dom.placeholderTitle.textContent = 'Conectando à transmissão...';
          dom.placeholderDesc.textContent = 'Estabelecendo conexão WebRTC em tempo real com o instrutor.';
        }

        // O host já dispara ofertas diretamente para todos os espectadores.
        // Fallback rápido após 1.2s se a oferta não tiver chegado
        if (!state.isHost) {
          clearTimeout(state.requestStreamTimeout);
          state.requestStreamTimeout = setTimeout(() => {
            const pc = state.peerConnections.get(state.creatorPeerId);
            if (!pc || (pc.connectionState !== 'connected' && pc.connectionState !== 'connecting')) {
              console.log('[P2P] Fallback: solicitando stream após timeout de espera...');
              sendRequest('requestStream').catch(() => {});
            }
          }, 1200);
        }
        break;
      }

      // Notificação de que o host encerrou transmissão
      case 'streamStopped': {
        console.log('[P2P] Host encerrou transmissão.');
        showToast('Transmissão encerrada pelo instrutor.', 'info');
        clearTimeout(state.requestStreamTimeout);
        closeAllPeerConnections();
        showWaitingState();
        break;
      }

      // Novo participante real conectado ou reconectado na sala
      case 'peerJoined': {
        const { peer } = notification;
        state.peers.set(peer.id, peer);

        if (peer.role === 'host') {
          state.creatorPeerId = peer.id;
        }

        renderPeerList();
        showToast(`${peer.displayName} está na sala`, 'info');

        // Se sou host e estou transmitindo, envia offer para o espectador que entrou
        if (state.isHost && state.isBroadcasting && state.screenStream && peer.role !== 'host') {
          setTimeout(() => {
            createOfferForViewer(peer.id, false);
          }, 400);
        }
        break;
      }

      // Participante desconectado da sala
      case 'peerLeft': {
        const { peerId } = notification;
        if (state.peers.has(peerId)) {
          const name = state.peers.get(peerId).displayName;
          state.peers.delete(peerId);
          renderPeerList();
          showToast(`${name} saiu da sala`, 'info');
        }
        // Fecha a peer connection associada
        closePeerConnection(peerId);

        // Se o host saiu, volta ao estado de espera
        if (peerId === state.creatorPeerId && !state.isHost) {
          showWaitingState();
        }
        break;
      }

      // Mensagem de Chat / Dúvidas em tempo real
      case 'chatMessage': {
        const { message } = notification;
        appendChatMessage(message);
        break;
      }

      // Notificação de encerramento definitivo da aula pelo instrutor
      case 'roomClosed': {
        const reason = notification.reason || 'A aula de instrução foi encerrada em definitivo pelo instrutor.';
        showToast(reason, 'warn', 8000);
        alert(reason);
        exitRoomToLobby();
        break;
      }
    }
  }

  // ========================================================================
  // WEBRTC PEER-TO-PEER: GERENCIAMENTO DE CONEXÕES
  // ========================================================================

  /**
   * Prioriza codecs com aceleração por hardware e inicialização instantânea (H264 / VP8) sobre AV1/VP9
   */
  function applyCodecPreferences(pc) {
    try {
      if (typeof RTCRtpReceiver !== 'undefined' && RTCRtpReceiver.getCapabilities) {
        const capabilities = RTCRtpReceiver.getCapabilities('video');
        if (capabilities && capabilities.codecs && capabilities.codecs.length > 0) {
          const h264 = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === 'video/h264');
          const vp8 = capabilities.codecs.filter(c => c.mimeType.toLowerCase() === 'video/vp8');
          const others = capabilities.codecs.filter(c => c.mimeType.toLowerCase() !== 'video/h264' && c.mimeType.toLowerCase() !== 'video/vp8');
          const preferredCodecs = [...h264, ...vp8, ...others];

          pc.getTransceivers().forEach(transceiver => {
            if (transceiver.setCodecPreferences) {
              const kind = transceiver.receiver?.track?.kind || transceiver.sender?.track?.kind;
              if (kind === 'video' || !kind) {
                try { transceiver.setCodecPreferences(preferredCodecs); } catch (e) {}
              }
            }
          });
        }
      }
    } catch (e) {
      console.warn('[P2P] Não foi possível definir preferências de codec:', e);
    }
  }

  /**
   * Força o codificador do navegador do host a emitir um IDR Keyframe imediatamente
   */
  async function forceKeyframeOnSender(viewerPeerId) {
    const pc = state.peerConnections.get(viewerPeerId);
    if (!pc || !state.screenStream) return;

    const videoTrack = state.screenStream.getVideoTracks()[0];
    if (!videoTrack) return;

    try {
      const senders = pc.getSenders();
      for (const sender of senders) {
        if (sender.track && sender.track.kind === 'video') {
          // 1. Tenta API direta de keyFrame via setParameters (Chrome 94+)
          try {
            const params = sender.getParameters();
            if (params && params.encodings && params.encodings.length > 0) {
              const encodingOptions = params.encodings.map(() => ({ keyFrame: true }));
              await sender.setParameters(params, { encodingOptions });
              console.log(`[P2P] Keyframe solicitado com sucesso via setParameters para ${viewerPeerId}`);
            }
          } catch (e) {}

          // 2. Re-sincronização de pipeline via replaceTrack (garante novo keyframe em todos os navegadores)
          try {
            await sender.replaceTrack(videoTrack);
            console.log(`[P2P] Track re-sincronizada via replaceTrack para ${viewerPeerId}`);
          } catch (e) {}
        }
      }
    } catch (err) {
      console.warn('[P2P] Erro ao forçar keyframe no sender:', err);
    }
  }

  /**
   * Espectador: monitora se os primeiros frames foram decodificados; se não, solicita keyframe ao host
   */
  let keyframeCheckTimer = null;
  function triggerKeyframeCheck(targetPeerId) {
    if (keyframeCheckTimer) clearInterval(keyframeCheckTimer);
    let attempts = 0;
    keyframeCheckTimer = setInterval(() => {
      attempts++;
      if (dom.remoteVideo.videoWidth > 0 || attempts > 8) {
        clearInterval(keyframeCheckTimer);
        return;
      }
      const pc = state.peerConnections.get(targetPeerId);
      if (pc && (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected')) {
        console.log(`[P2P] Vídeo ainda sem dimensões (${attempts}/8). Solicitando keyframe imediato ao host...`);
        sendSignal('requestKeyframe', { targetPeerId });
      }
    }, 600);
  }

  /**
   * Cria ou reutiliza uma RTCPeerConnection para um peer específico
   */
  function createPeerConnection(remotePeerId) {
    const existingPc = state.peerConnections.get(remotePeerId);
    if (existingPc) {
      try { existingPc.close(); } catch (e) {}
      state.peerConnections.delete(remotePeerId);
    }

    const iceConfig = {
      iceServers: (state.iceServers && state.iceServers.length > 0) ? state.iceServers : [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
        { urls: ['stun:stun.cloudflare.com:3478'] }
      ],
      iceCandidatePoolSize: 2,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    };

    const pc = new RTCPeerConnection(iceConfig);

    state.peerConnections.set(remotePeerId, pc);

    // IMPORTANTE: NÃO sobreescrever candidatos que já tenham chegado via WebSocket antes do PC ser criado!
    if (!state.pendingCandidates.has(remotePeerId)) {
      state.pendingCandidates.set(remotePeerId, []);
    }

    // Envia ICE candidates via sinalização imediatamente
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal('rtcIceCandidate', {
          targetPeerId: remotePeerId,
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
        });
      }
    };

    // Monitoramento de estado de conexão
    pc.onconnectionstatechange = () => {
      if (state.peerConnections.get(remotePeerId) !== pc) return;
      console.log(`[P2P] Conexão com ${remotePeerId}: ${pc.connectionState}`);

      if (pc.connectionState === 'connected') {
        updateConnectionIndicator('connected');
        if (state.isHost) {
          // Dispara keyframe imediato e faz reforços para renderização instantânea no aluno
          forceKeyframeOnSender(remotePeerId);
          setTimeout(() => forceKeyframeOnSender(remotePeerId), 300);
          setTimeout(() => forceKeyframeOnSender(remotePeerId), 800);
        } else {
          triggerKeyframeCheck(remotePeerId);
        }
        if (dom.remoteVideo.paused && dom.remoteVideo.srcObject) {
          dom.remoteVideo.play().catch(e => console.log('[Video] Play na conexão:', e));
        }
      } else if (pc.connectionState === 'connecting') {
        updateConnectionIndicator('connecting');
      } else if (pc.connectionState === 'failed') {
        console.warn(`[P2P] Conexão falhou com ${remotePeerId}.`);
        if (!state.isHost) {
          updateConnectionIndicator('connecting');
          setTimeout(() => {
            if (!state.isHost && state.currentRoomId) {
              const currentPc = state.peerConnections.get(remotePeerId);
              if (!currentPc || currentPc.connectionState !== 'connected') {
                console.log('[P2P] Tentando restabelecer stream com o instrutor...');
                sendRequest('requestStream').catch(() => {});
              }
            }
          }, 1500);
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (state.peerConnections.get(remotePeerId) !== pc) return;
      console.log(`[P2P] ICE State com ${remotePeerId}: ${pc.iceConnectionState}`);

      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        updateConnectionIndicator('connected');
        if (state.isHost) {
          forceKeyframeOnSender(remotePeerId);
        }
        if (dom.remoteVideo.paused && dom.remoteVideo.srcObject) {
          dom.remoteVideo.play().catch(() => {});
        }
      } else if (pc.iceConnectionState === 'checking') {
        updateConnectionIndicator('connecting');
      } else if (pc.iceConnectionState === 'failed') {
        console.warn(`[P2P] ICE falhou com ${remotePeerId}.`);
        if (state.isHost) {
          try { pc.restartIce(); } catch (e) {}
        }
      }
    };

    return pc;
  }

  /**
   * HOST: Cria offer e envia stream para um espectador específico
   */
  async function createOfferForViewer(viewerPeerId, forceNew = false) {
    if (!state.isHost || !state.screenStream) return;

    if (!forceNew) {
      const existingPc = state.peerConnections.get(viewerPeerId);
      if (existingPc && (existingPc.connectionState === 'connected' || existingPc.signalingState === 'have-local-offer')) {
        console.log(`[P2P] Conexão já em andamento com ${viewerPeerId}. Forçando keyframe.`);
        forceKeyframeOnSender(viewerPeerId);
        return;
      }
    } else {
      closePeerConnection(viewerPeerId);
    }

    const pc = createPeerConnection(viewerPeerId);

    // Adiciona todas as tracks do stream de tela como sendonly
    state.screenStream.getTracks().forEach(track => {
      const sender = pc.addTrack(track, state.screenStream);
      const transceiver = pc.getTransceivers().find(t => t.sender === sender);
      if (transceiver) {
        transceiver.direction = 'sendonly';
      }
    });

    // Se houver microfone ativo, adiciona também como sendonly
    if (state.micStream) {
      state.micStream.getTracks().forEach(track => {
        const sender = pc.addTrack(track, state.micStream);
        const transceiver = pc.getTransceivers().find(t => t.sender === sender);
        if (transceiver) {
          transceiver.direction = 'sendonly';
        }
      });
    }

    applyCodecPreferences(pc);

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });
      await pc.setLocalDescription(offer);

      await sendRequest('rtcOffer', {
        targetPeerId: viewerPeerId,
        offer: pc.localDescription.toJSON()
      });

      console.log(`[P2P] Offer enviada com sucesso para ${viewerPeerId}`);
    } catch (err) {
      console.error('[P2P] Erro ao criar/enviar offer:', err);
    }
  }

  /**
   * ESPECTADOR: Recebe offer do host, configura player de vídeo e cria answer
   */
  async function handleIncomingOffer(fromPeerId, offer) {
    console.log(`[P2P] Processando offer de ${fromPeerId}...`);
    clearTimeout(state.requestStreamTimeout);
    updateConnectionIndicator('connecting');

    const pc = createPeerConnection(fromPeerId);

    // Configura recepção de tracks remotas
    pc.ontrack = (event) => {
      console.log(`[P2P] Track recebida: tipo=${event.track.kind}, id=${event.track.id}`);

      if (event.track.kind === 'video') {
        const stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
        dom.remoteVideo.srcObject = stream;
        dom.remoteVideo.muted = true; // ESSENCIAL: Permite reprodução imediata sem bloqueio de autoplay

        const markReady = () => {
          if (dom.remoteVideo.videoWidth > 0 && dom.remoteVideo.videoHeight > 0) {
            dom.placeholderStage.style.display = 'none';
            dom.streamInfoBadge.style.display = 'flex';
            dom.streamInfoText.textContent = `Transmissão Ativa: ${dom.remoteVideo.videoWidth}×${dom.remoteVideo.videoHeight}`;
            dom.liveIndicator.className = 'badge-pulse';
            dom.liveText.textContent = 'AO VIVO';
            updateConnectionIndicator('connected');
          }
        };

        dom.remoteVideo.play()
          .then(markReady)
          .catch(err => {
            console.warn('[Video] Play automático pendente:', err);
          });

        // Garante exibição assim que os primeiros frames forem renderizados
        event.track.onunmute = () => {
          console.log('[Video] Track ativa com frames recebidos (onunmute)');
          dom.remoteVideo.play().then(markReady).catch(() => {});
        };

        dom.remoteVideo.onloadedmetadata = () => {
          dom.remoteVideo.play().then(markReady).catch(() => {});
        };

        dom.remoteVideo.onloadeddata = markReady;
        dom.remoteVideo.onresize = markReady;

        // Inicia monitoramento de chegada do keyframe
        triggerKeyframeCheck(fromPeerId);

        // Se o stream de vídeo também trouxer trilha de áudio embutida
        if (event.streams && event.streams[0]) {
          const audioTracks = event.streams[0].getAudioTracks();
          if (audioTracks.length > 0 && (!dom.remoteAudio.srcObject || !dom.remoteAudio.srcObject.active)) {
            console.log('[Audio] Trilha de som identificada no stream de vídeo.');
            dom.remoteAudio.srcObject = new MediaStream(audioTracks);
            dom.remoteAudio.muted = false;
            dom.remoteAudio.volume = 1.0;
            dom.remoteAudio.play().then(hideUnmuteOverlay).catch(showUnmuteOverlay);
          }
        }

        startTelemetryStats(pc);
      } else if (event.track.kind === 'audio') {
        console.log('[P2P] Trilha de áudio remota recebida explicitamente!');
        const audioStream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
        dom.remoteAudio.srcObject = audioStream;
        dom.remoteAudio.muted = false;
        dom.remoteAudio.volume = 1.0;

        const tryPlayAudio = () => {
          dom.remoteAudio.play()
            .then(() => {
              console.log('[Audio] Áudio tocando com sucesso!');
              hideUnmuteOverlay();
            })
            .catch(err => {
              console.warn('[Audio] Autoplay de áudio bloqueado pelo navegador, aguardando interação do usuário:', err);
              showUnmuteOverlay();
            });
        };

        tryPlayAudio();
        event.track.onunmute = tryPlayAudio;
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Aplica imediatamente candidatos ICE que já estavam em buffer
      const pending = state.pendingCandidates.get(fromPeerId) || [];
      state.pendingCandidates.set(fromPeerId, []);
      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn('[P2P] Erro ao aplicar candidato ICE em buffer:', e);
        }
      }

      applyCodecPreferences(pc);

      // Garante que transceivers estejam em recvonly no espectador
      pc.getTransceivers().forEach(transceiver => {
        if (transceiver.direction === 'sendrecv' || transceiver.direction === 'sendonly') {
          transceiver.direction = 'recvonly';
        }
      });

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendSignal('rtcAnswer', {
        targetPeerId: fromPeerId,
        answer: pc.localDescription.toJSON()
      });

      console.log(`[P2P] Answer enviada com sucesso para ${fromPeerId}`);
    } catch (err) {
      console.error('[P2P] Erro ao processar offer:', err);
    }
  }

  /**
   * HOST: Recebe answer de um espectador
   */
  async function handleIncomingAnswer(fromPeerId, answer) {
    const pc = state.peerConnections.get(fromPeerId);
    if (!pc) {
      console.warn('[P2P] Nenhuma PeerConnection encontrada para answer de', fromPeerId);
      return;
    }

    if (pc.signalingState !== 'have-local-offer') {
      console.warn(`[P2P] Ignorando answer de ${fromPeerId}: estado de sinalização atual é "${pc.signalingState}"`);
      return;
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      // Aplica candidatos ICE pendentes em buffer
      const pending = state.pendingCandidates.get(fromPeerId) || [];
      state.pendingCandidates.set(fromPeerId, []);
      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.warn('[P2P] Erro ao aplicar candidato ICE em buffer:', e);
        }
      }

      console.log(`[P2P] Conexão P2P estabelecida com espectador ${fromPeerId}`);

      // Força geração de keyframe imediatamente e agenda reforço para renderização instantânea
      forceKeyframeOnSender(fromPeerId);
      setTimeout(() => forceKeyframeOnSender(fromPeerId), 300);
      setTimeout(() => forceKeyframeOnSender(fromPeerId), 900);
    } catch (err) {
      console.error('[P2P] Erro ao processar answer:', err);
    }
  }

  /**
   * Processa ICE candidate recebido (armazena em buffer caso remoteDescription ainda não esteja pronta)
   */
  async function handleIncomingIceCandidate(fromPeerId, candidate) {
    const pc = state.peerConnections.get(fromPeerId);

    // Se o PC ou remoteDescription ainda não estiverem prontos, armazena no buffer
    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
      if (!state.pendingCandidates.has(fromPeerId)) {
        state.pendingCandidates.set(fromPeerId, []);
      }
      state.pendingCandidates.get(fromPeerId).push(candidate);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[P2P] Erro ao adicionar ICE candidate:', err);
    }
  }

  /**
   * Fecha uma peer connection específica
   */
  function closePeerConnection(peerId) {
    const pc = state.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      state.peerConnections.delete(peerId);
    }
    state.pendingCandidates.delete(peerId);
  }

  /**
   * Fecha todas as peer connections
   */
  function closeAllPeerConnections() {
    for (const [peerId, pc] of state.peerConnections.entries()) {
      pc.close();
    }
    state.peerConnections.clear();
    state.pendingCandidates.clear();
  }

  // ========================================================================
  // COMPARTILHAMENTO DE TELA (getDisplayMedia)
  // ========================================================================
  async function startScreenSharing() {
    // Permissão: Somente o criador/host pode compartilhar tela
    if (!state.isHost) {
      showToast('Apenas o criador da sala possui permissão para compartilhar tela.', 'warn');
      return;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        showToast('Navegador não suporta getDisplayMedia para captura de tela.', 'error');
        return;
      }

      // Parâmetros de Resolução e Taxa de Quadros
      const maxRes = parseInt(state.preferences.maxResolution, 10);
      const targetFps = parseInt(state.preferences.maxFps, 10);
      const isMotion = state.preferences.preset === 'motion';

      let widthTarget = 1920;
      let heightTarget = 1080;
      if (maxRes === 720) {
        widthTarget = 1280;
        heightTarget = 720;
      } else if (maxRes === 480) {
        widthTarget = 854;
        heightTarget = 480;
      }

      // Restrições WebRTC para getDisplayMedia
      const displayConstraints = {
        video: {
          width: { ideal: widthTarget, max: widthTarget },
          height: { ideal: heightTarget, max: heightTarget },
          frameRate: { ideal: targetFps, max: targetFps },
          cursor: 'always',
          displaySurface: 'monitor'
        },
        audio: state.preferences.systemAudio ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false
        } : false
      };

      console.log('[ScreenShare] Solicitando getDisplayMedia com constraints:', displayConstraints);
      let stream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
      } catch (err) {
        // Fallback: se o navegador rejeitar o objeto de áudio avançado, tenta com audio: true simples
        if (state.preferences.systemAudio && err.name !== 'NotAllowedError') {
          console.warn('[ScreenShare] Falha com constraints detalhadas de áudio, tentando com audio: true...');
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: displayConstraints.video,
            audio: true
          });
        } else {
          throw err;
        }
      }

      state.screenStream = stream;
      state.isBroadcasting = true;

      const videoTrack = stream.getVideoTracks()[0];
      const audioTracks = stream.getAudioTracks();

      // Garante contentHint 'motion' para que o Chromium mantenha o envio ativo de quadros
      if (videoTrack) {
        videoTrack.contentHint = 'motion';
        console.log('[ScreenShare] contentHint definido como: "motion" (fluidez contínua)');

        // Detecta encerramento nativo pelo botão "Interromper compartilhamento" do navegador
        videoTrack.onended = () => {
          console.log('[ScreenShare] Compartilhamento interrompido pelo usuário no navegador.');
          stopScreenSharing();
          showToast('Compartilhamento de tela encerrado.', 'info');
        };
      }

      // Verificação amigável de áudio do sistema
      if (state.preferences.systemAudio && audioTracks.length === 0) {
        showToast('Aviso: Áudio não selecionado. Ao escolher a tela/aba no popup do navegador, marque a caixa "Compartilhar áudio" para transmitir o som.', 'warn', 8000);
      } else if (audioTracks.length > 0) {
        showToast(`Áudio do sistema capturado com sucesso (${audioTracks.length} trilha).`, 'ok');
      }

      // Mostra preview local (mutado para evitar eco)
      dom.remoteVideo.srcObject = stream;
      dom.remoteVideo.muted = true;
      dom.placeholderStage.style.display = 'none';
      dom.streamInfoBadge.style.display = 'flex';
      dom.streamInfoText.textContent = `Você está transmitindo: ${widthTarget}p @ ${targetFps} FPS (${isMotion ? 'Fluidez' : 'Nitidez'})`;

      dom.btnCtrlScreen.classList.add('active');
      dom.labelCtrlScreen.textContent = 'Parar Tela';
      dom.liveIndicator.className = 'badge-pulse';
      dom.liveText.textContent = 'AO VIVO';

      // Notifica o servidor que a transmissão começou
      await sendRequest('streamStarted', {
        streamInfo: {
          resolution: `${widthTarget}p`,
          fps: targetFps,
          mode: isMotion ? 'motion' : 'detail'
        }
      });

      // Atualiza lista mais recente de membros antes de ofertar
      try {
        await refreshRoomPeers();
      } catch (e) {}

      // Envia stream para todos os espectadores já conectados de forma paralela
      const offerPromises = [];
      for (const [peerId, peer] of state.peers.entries()) {
        if (peerId !== state.peerId && peer.role !== 'host') {
          offerPromises.push(createOfferForViewer(peerId, true));
        }
      }
      await Promise.all(offerPromises);

      showToast('Transmissão de tela iniciada via WebRTC P2P.', 'ok');

      // Inicia telemetria com a primeira peer connection disponível
      if (state.peerConnections.size > 0) {
        const firstPc = state.peerConnections.values().next().value;
        startTelemetryStats(firstPc);
      }

      renderPeerList();

    } catch (err) {
      if (err.name === 'NotAllowedError') {
        showToast('Seleção de tela cancelada pelo usuário.', 'info');
      } else {
        console.error('[ScreenShare] Erro ao iniciar captura:', err);
        showToast(`Falha ao compartilhar tela: ${err.message}`, 'error');
      }
    }
  }

  async function stopScreenSharing() {
    if (state.screenStream) {
      state.screenStream.getTracks().forEach(t => t.stop());
      state.screenStream = null;
    }

    state.isBroadcasting = false;

    // Fecha todas as peer connections com espectadores
    closeAllPeerConnections();

    // Notifica o servidor
    try {
      await sendRequest('streamStopped');
    } catch (e) {
      console.warn('[ScreenShare] Erro ao notificar server:', e);
    }

    // Restaura interface
    dom.remoteVideo.srcObject = null;
    dom.streamInfoBadge.style.display = 'none';
    dom.btnCtrlScreen.classList.remove('active');
    dom.labelCtrlScreen.textContent = 'Transmitir';

    showWaitingState();
    renderPeerList();
  }

  function showWaitingState() {
    dom.remoteVideo.srcObject = null;
    dom.remoteAudio.srcObject = null;
    dom.placeholderStage.style.display = 'flex';
    dom.streamInfoBadge.style.display = 'none';
    dom.liveIndicator.className = 'badge-tag badge-idle';
    dom.liveText.textContent = 'EM ESPERA';
    stopTelemetryStats();
  }

  // ========================================================================
  // WEBCAM E MICROFONE REAIS DO USUÁRIO
  // ========================================================================
  async function toggleWebcam() {
    if (!state.isHost) {
      showToast('Apenas o criador da sala possui permissão para ativar câmera.', 'warn');
      return;
    }

    try {
      if (state.webcamStream) {
        // Desligar webcam
        state.webcamStream.getTracks().forEach(t => t.stop());
        state.webcamStream = null;
        dom.localWebcam.srcObject = null;
        dom.webcamPip.classList.remove('active');
        dom.btnCtrlCam.classList.remove('active');
        dom.btnCtrlCam.classList.add('muted');
        dom.iconCtrlCam.textContent = 'videocam_off';
        dom.labelCtrlCam.textContent = 'Câmera Off';
      } else {
        // Ligar webcam real
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 360, frameRate: 30 },
          audio: false
        });
        state.webcamStream = stream;
        dom.localWebcam.srcObject = stream;
        dom.webcamPip.classList.add('active');
        dom.btnCtrlCam.classList.add('active');
        dom.btnCtrlCam.classList.remove('muted');
        dom.iconCtrlCam.textContent = 'videocam';
        dom.labelCtrlCam.textContent = 'Câmera On';
        showToast('Câmera do operador ativada em Picture-in-Picture.', 'ok');
      }
    } catch (err) {
      showToast(`Não foi possível acessar a câmera: ${err.message}`, 'error');
    }
  }

  async function toggleMicrophone() {
    if (!state.isHost) {
      showToast('Apenas o criador da sala possui permissão para ativar microfone.', 'warn');
      return;
    }

    try {
      if (state.micStream) {
        // Desligar microfone
        state.micStream.getTracks().forEach(t => t.stop());
        state.micStream = null;
        dom.btnCtrlMic.classList.remove('active');
        dom.btnCtrlMic.classList.add('muted');
        dom.iconCtrlMic.textContent = 'mic_off';
        dom.labelCtrlMic.textContent = 'Voz Off';
      } else {
        // Ligar microfone real
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false
        });
        state.micStream = stream;
        dom.btnCtrlMic.classList.add('active');
        dom.btnCtrlMic.classList.remove('muted');
        dom.iconCtrlMic.textContent = 'mic';
        dom.labelCtrlMic.textContent = 'Voz On';
        showToast('Microfone ativado.', 'ok');

        // Se estiver transmitindo, adiciona mic e renegocia para os espectadores ouvirem
        if (state.isBroadcasting) {
          for (const [peerId, pc] of state.peerConnections.entries()) {
            try {
              stream.getTracks().forEach(track => {
                pc.addTrack(track, stream);
              });
              pc.createOffer().then(offer => {
                return pc.setLocalDescription(offer);
              }).then(() => {
                return sendRequest('rtcOffer', {
                  targetPeerId: peerId,
                  offer: pc.localDescription.toJSON()
                });
              }).catch(err => console.warn('[Mic] Erro na renegociação de mic:', err));
            } catch (e) {
              console.warn('[Mic] Erro ao adicionar track de mic:', e);
            }
          }
        }
      }
    } catch (err) {
      showToast(`Não foi possível acessar o microfone: ${err.message}`, 'error');
    }
  }

  // ========================================================================
  // CONTROLE E DESBLOQUEIO DE ÁUDIO NO NAVEGADOR
  // ========================================================================
  function showUnmuteOverlay() {
    if (dom.btnUnmuteAudio && !state.isHost) {
      dom.btnUnmuteAudio.style.display = 'inline-flex';
    }
  }

  function hideUnmuteOverlay() {
    if (dom.btnUnmuteAudio) {
      dom.btnUnmuteAudio.style.display = 'none';
    }
  }

  function unlockAudio() {
    if (dom.remoteAudio && dom.remoteAudio.srcObject) {
      dom.remoteAudio.muted = false;
      dom.remoteAudio.volume = 1.0;
      dom.remoteAudio.play()
        .then(() => {
          hideUnmuteOverlay();
        })
        .catch(err => {
          console.warn('[Audio] Falha ao desbloquear áudio:', err);
        });
    }
  }

  // ========================================================================
  // TELEMETRIA E DIAGNÓSTICO WEBRTC EM TEMPO REAL (getStats)
  // ========================================================================
  function startTelemetryStats(pcOrEntity) {
    stopTelemetryStats();
    state.lastBytes = 0;
    state.lastStatsTimestamp = 0;

    state.statsInterval = setInterval(async () => {
      try {
        // Pega a primeira PeerConnection ativa para telemetria
        let pc = pcOrEntity;
        if (!pc || pc.connectionState === 'closed') {
          // Tenta pegar qualquer PC ativa
          for (const activePc of state.peerConnections.values()) {
            if (activePc.connectionState !== 'closed') {
              pc = activePc;
              break;
            }
          }
        }
        if (!pc || pc.connectionState === 'closed') return;

        const stats = await pc.getStats();
        let fps = 0;
        let width = 0;
        let height = 0;
        let bitrate = 0;
        let rtt = 0;
        let jitter = 0;
        let packetsLost = 0;
        let totalPackets = 0;
        let codec = 'VP8 / H.264';
        let transportType = 'UDP';

        stats.forEach((report) => {
          // Relatório de envio (outbound-rtp)
          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            fps = report.framesPerSecond || fps;
            width = report.frameWidth || width;
            height = report.frameHeight || height;

            const now = report.timestamp;
            const bytes = report.bytesSent;
            if (state.lastStatsTimestamp && state.lastBytes) {
              const deltaMs = now - state.lastStatsTimestamp;
              const deltaBytes = bytes - state.lastBytes;
              if (deltaMs > 0 && deltaBytes >= 0) {
                bitrate = Math.round((deltaBytes * 8) / deltaMs); // kbps
              }
            }
            state.lastBytes = bytes;
            state.lastStatsTimestamp = now;
          }

          // Relatório de recepção (inbound-rtp)
          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            fps = report.framesPerSecond || fps;
            width = report.frameWidth || width;
            height = report.frameHeight || height;
            jitter = Math.round((report.jitter || 0) * 1000);
            packetsLost = report.packetsLost || 0;
            totalPackets = (report.packetsReceived || 0) + packetsLost;

            const now = report.timestamp;
            const bytes = report.bytesReceived;
            if (state.lastStatsTimestamp && state.lastBytes) {
              const deltaMs = now - state.lastStatsTimestamp;
              const deltaBytes = bytes - state.lastBytes;
              if (deltaMs > 0 && deltaBytes >= 0) {
                bitrate = Math.round((deltaBytes * 8) / deltaMs); // kbps
              }
            }
            state.lastBytes = bytes;
            state.lastStatsTimestamp = now;
          }

          // Relatório de par de candidatos (ICE Candidate-Pair)
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = Math.round((report.currentRoundTripTime || 0) * 1000);
          }

          // Codec
          if (report.type === 'codec') {
            if (report.mimeType) codec = report.mimeType.replace('video/', '');
          }
        });

        // Atualiza DOM da aba de métricas
        if (fps > 0) dom.statFps.textContent = `${fps} FPS`;
        else if (width > 0) dom.statFps.textContent = '-- FPS';

        if (width > 0 && height > 0) {
          dom.statRes.textContent = `${width} × ${height}`;
          const ratio = (width / height).toFixed(2);
          dom.statAspect.textContent = `Proporção: ${ratio}:1 (${width >= 1920 ? 'FHD' : 'HD'})`;
        }

        if (bitrate > 0) {
          dom.statBitrate.textContent = `${bitrate} kbps`;
        }

        if (rtt > 0) {
          dom.statRtt.textContent = `${rtt} ms`;
          dom.statRttStatus.textContent = rtt < 40 ? 'Excelente' : rtt < 100 ? 'Estável' : 'Alta Latência';
        } else {
          dom.statRtt.textContent = '< 5 ms';
          dom.statRttStatus.textContent = 'Localhost (Zero Jitter)';
        }

        if (totalPackets > 0) {
          const lossPercent = ((packetsLost / totalPackets) * 100).toFixed(1);
          dom.statPacketLoss.textContent = `${lossPercent}%`;
          dom.statPacketCount.textContent = `${packetsLost} pacotes`;
        }

        if (jitter > 0) {
          dom.statJitter.textContent = `${jitter} ms`;
        } else {
          dom.statJitter.textContent = '0 ms';
        }

        dom.statCodec.textContent = codec;
        dom.statTransportType.textContent = transportType;

      } catch (e) {
        console.warn('[Telemetry] Erro ao obter stats WebRTC:', e);
      }
    }, 1000);
  }

  function stopTelemetryStats() {
    if (state.statsInterval) {
      clearInterval(state.statsInterval);
      state.statsInterval = null;
    }
    dom.statFps.textContent = '--';
    dom.statRes.textContent = '--';
    dom.statBitrate.textContent = '-- kbps';
    dom.statRtt.textContent = '-- ms';
    dom.statPacketLoss.textContent = '0.0%';
    dom.statJitter.textContent = '-- ms';
  }

  // ========================================================================
  // PARTICIPANTES REAIS & RENDERIZAÇÃO
  // ========================================================================
  function renderPeerList() {
    dom.peerList.innerHTML = '';

    // Participante local
    const isTransmitting = state.isBroadcasting;
    const myInitials = state.displayName.substring(0, 2).toUpperCase();

    const localItem = document.createElement('div');
    localItem.className = 'peer-item';
    localItem.style.borderLeft = state.isHost ? '3px solid var(--primary-container)' : '3px solid var(--secondary)';
    localItem.innerHTML = `
      <div class="peer-info">
        <div class="peer-badge-avatar" style="${state.isHost ? 'background-color: var(--primary-container); color: #fff;' : 'background-color: var(--surface-container-highest); color: var(--secondary);'}">
          ${myInitials}
        </div>
        <div>
          <div class="peer-name">${escapeHtml(state.displayName)} <span style="font-size: 11px; color: ${state.isHost ? 'var(--primary)' : 'var(--secondary)'};">(Você)</span></div>
          <div class="peer-role">${state.isHost ? 'INSTRUTOR / CRIADOR' : 'ESPECTADOR'}</div>
        </div>
      </div>
      <div style="display: flex; gap: 4px; color: var(--primary);">
        ${isTransmitting ? '<span class="material-symbols-outlined" style="font-size: 18px;" title="Transmitindo Tela">screen_share</span>' : ''}
        ${state.micStream ? '<span class="material-symbols-outlined" style="font-size: 18px;" title="Microfone Ativo">mic</span>' : ''}
      </div>
    `;
    dom.peerList.appendChild(localItem);

    // Outros participantes reais conectados na sala
    let count = 1;
    for (const [pId, peer] of state.peers.entries()) {
      if (pId === state.peerId) continue;
      count++;

      const isPeerHost = (peer.role === 'host') || (peer.id === state.creatorPeerId);
      const initials = (peer.displayName || 'PM').substring(0, 2).toUpperCase();
      const item = document.createElement('div');
      item.className = 'peer-item';
      if (isPeerHost) {
        item.style.borderLeft = '3px solid var(--primary-container)';
      }
      item.innerHTML = `
        <div class="peer-info">
          <div class="peer-badge-avatar" style="${isPeerHost ? 'background-color: rgba(211,47,47,0.3); color: #ff8a80;' : ''}">${initials}</div>
          <div>
            <div class="peer-name">${escapeHtml(peer.displayName)}</div>
            <div class="peer-role">${isPeerHost ? 'INSTRUTOR / CRIADOR' : 'ESPECTADOR'}</div>
          </div>
        </div>
        <div style="display: flex; gap: 4px; color: ${isPeerHost ? 'var(--primary)' : 'var(--tertiary)'};">
          ${isPeerHost ? '<span class="material-symbols-outlined" style="font-size: 16px;" title="Instrutor da Sala">school</span>' : '<span class="material-symbols-outlined" style="font-size: 16px;">visibility</span>'}
        </div>
      `;
      dom.peerList.appendChild(item);
    }

    // Atualiza contadores
    dom.tabUsersCount.textContent = count;
    dom.labelCtrlUsers.textContent = `${count} Online`;
  }

  /**
   * Sincroniza ativamente a lista de participantes com o servidor
   */
  async function refreshRoomPeers() {
    if (!state.currentRoomId) return;
    try {
      const response = await sendRequest('getRoomPeers');
      if (response && response.peers) {
        state.peers.clear();
        response.peers.forEach(p => state.peers.set(p.id, p));
        renderPeerList();
      }
    } catch (e) {
      // Ignora erro temporário se socket estiver ocupado
    }
  }

  // ========================================================================
  // CONTROLE DE PERMISSÕES DA UI (CRIADOR VS ESPECTADOR)
  // ========================================================================
  function applyRolePermissions() {
    if (state.isHost) {
      // Criador da sala: Acesso total aos controles de transmissão
      dom.hostMediaControls.style.display = 'flex';
      dom.spectatorModeBadge.style.display = 'none';

      dom.placeholderTitle.textContent = 'Nenhuma transmissão ativa nesta sala';
      dom.placeholderDesc.textContent = 'Você é o instrutor desta sala. Inicie o compartilhamento de tela com suporte a 60 FPS, resolução Full HD e áudio do sistema.';
      dom.btnStageStartShare.style.display = 'inline-flex';
      dom.placeholderIconSymbol.textContent = 'screen_share';

      dom.headerUserRole.textContent = 'Instrutor Titular (Criador)';

      // Configuração visual do botão de encerrar para o Instrutor
      if (dom.iconCtrlExit) dom.iconCtrlExit.textContent = 'power_settings_new';
      if (dom.labelCtrlExit) dom.labelCtrlExit.textContent = 'Encerrar Aula';
      if (dom.btnCtrlExit) {
        dom.btnCtrlExit.title = 'Encerrar a Aula e Fechar a Sala para Todos';
        dom.btnCtrlExit.style.backgroundColor = 'rgba(211, 47, 47, 0.2)';
        dom.btnCtrlExit.style.borderColor = 'rgba(211, 47, 47, 0.4)';
        dom.btnCtrlExit.style.color = '#ff8a80';
      }
    } else {
      // Espectador: Apenas assistir e interagir na aba de dúvidas
      dom.hostMediaControls.style.display = 'none';
      dom.spectatorModeBadge.style.display = 'flex';

      dom.placeholderTitle.textContent = 'Aguardando o Instrutor';
      dom.placeholderDesc.textContent = 'Você ingressou como espectador. O criador da sala ainda não iniciou a transmissão. O vídeo aparecerá aqui automaticamente quando a aula começar. Você pode enviar suas dúvidas na aba lateral.';
      dom.btnStageStartShare.style.display = 'none';
      dom.placeholderIconSymbol.textContent = 'tv';

      dom.headerUserRole.textContent = 'Espectador / Participante';

      // Configuração visual do botão de sair para Alunos/Espectadores
      if (dom.iconCtrlExit) dom.iconCtrlExit.textContent = 'logout';
      if (dom.labelCtrlExit) dom.labelCtrlExit.textContent = 'Sair';
      if (dom.btnCtrlExit) {
        dom.btnCtrlExit.title = 'Sair da Sala';
        dom.btnCtrlExit.style.backgroundColor = '';
        dom.btnCtrlExit.style.borderColor = '';
        dom.btnCtrlExit.style.color = '';
      }
    }
  }

  // ========================================================================
  // CHAT & DÚVIDAS REAIS
  // ========================================================================
  function appendChatMessage(msg) {
    // Se era o empty state, limpa
    const emptyState = dom.chatMessagesContainer.querySelector('.empty-state');
    if (emptyState) emptyState.remove();

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';

    const isMe = msg.senderId === state.peerId;

    bubble.innerHTML = `
      <div class="chat-bubble-header">
        <span class="chat-sender" style="${isMe ? 'color: var(--primary);' : 'color: var(--secondary);'}">
          ${escapeHtml(msg.senderName)}${isMe ? ' (Você)' : ''}
        </span>
        <span class="chat-time">${escapeHtml(msg.timestamp)}</span>
      </div>
      <div class="chat-text">${escapeHtml(msg.text)}</div>
    `;

    dom.chatMessagesContainer.appendChild(bubble);
    dom.chatMessagesContainer.scrollTop = dom.chatMessagesContainer.scrollHeight;
  }

  async function sendChatMessage() {
    const text = dom.chatInput.value.trim();
    if (!text) return;

    try {
      await sendRequest('chatMessage', {
        text,
        senderName: state.displayName,
        messageType: 'chat'
      });
      dom.chatInput.value = '';
    } catch (err) {
      showToast(`Erro ao enviar mensagem: ${err.message}`, 'error');
    }
  }

  // ========================================================================
  // CRONÔMETRO DA SESSÃO & SINCRONIZAÇÃO PERIÓDICA
  // ========================================================================
  function startSessionTimer() {
    state.sessionStartTime = Date.now();
    clearInterval(state.sessionTimerInterval);

    state.sessionTimerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.sessionStartTime) / 1000);
      const hours = String(Math.floor(elapsed / 3600)).padStart(2, '0');
      const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
      const seconds = String(elapsed % 60).padStart(2, '0');
      dom.sessionTimer.textContent = `${hours}:${minutes}:${seconds}`;

      // A cada 5 segundos, sincroniza ativamente a lista de efetivo com o servidor
      if (elapsed > 0 && elapsed % 5 === 0) {
        refreshRoomPeers();
      }
    }, 1000);
  }

  function stopSessionTimer() {
    clearInterval(state.sessionTimerInterval);
    dom.sessionTimer.textContent = '00:00:00';
  }

  // ========================================================================
  // GERENCIAMENTO DE SALAS (CRIAR E ENTRAR)
  // ========================================================================
  async function createAndJoinRoom() {
    const topic = dom.inputCreateTopic.value.trim() || 'Instrução Operacional';
    const username = dom.inputCreateUsername.value.trim() || 'Operador Local';

    let pin = null;
    if (dom.createRequirePassword && dom.createRequirePassword.checked) {
      pin = (dom.createPassword.value || '').trim();
      if (!/^\d{4}$/.test(pin)) {
        showToast('A senha da sala deve conter exatamente 4 dígitos numéricos.', 'warn');
        dom.createPassword.focus();
        return;
      }
    }

    try {
      localStorage.setItem('pmesp_user_name', username);
    } catch (e) {}

    // Gera código institucional estilo PMESP-XXX-X
    const randomNum = Math.floor(100 + Math.random() * 900);
    const letters = ['A', 'B', 'C', 'D', 'X'];
    const letter = letters[Math.floor(Math.random() * letters.length)];
    const roomId = `PMESP-${randomNum}-${letter}`;

    state.displayName = username;
    dom.headerUserDisplay.textContent = username;
    dom.headerUserAvatar.textContent = username.substring(0, 2).toUpperCase();

    await joinRoom(roomId, topic, true, pin);
  }

  async function joinExistingRoom() {
    let code = (dom.inputJoinCode && dom.inputJoinCode.value) ? dom.inputJoinCode.value.trim().toUpperCase() : '';
    if (!code) {
      code = getRoomFromUrl() || '';
    }

    const username = (dom.inputJoinUsername && dom.inputJoinUsername.value) ? dom.inputJoinUsername.value.trim() : 'Operador Local';
    const pin = (dom.joinPassword && dom.joinPassword.value) ? dom.joinPassword.value.trim() : null;

    if (!code) {
      showToast('Por favor, informe o código da sala.', 'warn');
      if (dom.inputJoinCode) dom.inputJoinCode.focus();
      return;
    }

    try {
      localStorage.setItem('pmesp_user_name', username);
    } catch (e) {}

    state.displayName = username;
    dom.headerUserDisplay.textContent = username;
    dom.headerUserAvatar.textContent = username.substring(0, 2).toUpperCase();

    await joinRoom(code, 'Instrução em Andamento', false, pin);
  }

  // ========================================================================
  // COMPARTILHAMENTO DE LINK DA SALA
  // ========================================================================
  function copyInviteLink() {
    if (!state.currentRoomId) {
      showToast('Nenhuma sala ativa para compartilhar.', 'warn');
      return;
    }

    const base = window.location.origin;
    const inviteUrl = `${base}/?room=${encodeURIComponent(state.currentRoomId)}`;

    const onCopied = () => {
      if (dom.copyText) dom.copyText.textContent = 'Link Copiado! ✓';
      if (dom.copyTextSidebar) dom.copyTextSidebar.textContent = 'Link Copiado! ✓';
      showToast(`Link copiado com sucesso: ${inviteUrl}`, 'ok', 6000);

      setTimeout(() => {
        if (dom.copyText) dom.copyText.textContent = 'Copiar Link da Sala';
        if (dom.copyTextSidebar) dom.copyTextSidebar.textContent = 'Compartilhar Link da Sala';
      }, 3000);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inviteUrl)
        .then(onCopied)
        .catch(() => fallbackCopy(inviteUrl, onCopied));
    } else {
      fallbackCopy(inviteUrl, onCopied);
    }
  }

  function fallbackCopy(text, callback) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      callback();
    } catch (e) {
      window.prompt('Copie o link abaixo para compartilhar com os participantes:', text);
    }
    document.body.removeChild(ta);
  }

  async function joinRoom(roomId, topic, isCreating = false, password = null) {
    try {
      showToast(`Conectando à sala ${roomId}...`, 'info');

      // Recupera hostToken salvo se este usuário for o criador original da sala
      let storedHostToken = null;
      try {
        storedHostToken = localStorage.getItem(`pmesp_host_token_${roomId}`);
      } catch (e) {}

      const response = await sendRequest('join', {
        roomId,
        peerId: state.peerId,
        displayName: state.displayName,
        isCreating: isCreating,
        topic,
        password,
        hostToken: storedHostToken
      });

      // Salva hostToken permanentemente se emitido para o host
      if (response.hostToken) {
        try {
          localStorage.setItem(`pmesp_host_token_${response.roomId}`, response.hostToken);
        } catch (e) {}
      }

      state.currentRoomId = response.roomId;
      state.currentRoomTopic = response.topic || topic;
      state.isHost = !!response.isHost;
      state.role = response.role || (state.isHost ? 'host' : 'spectator');
      state.creatorPeerId = response.creatorPeerId;
      state.iceServers = response.iceServers || [];

      // Persiste sessão ativa no sessionStorage (mantém conectado caso a página seja recarregada)
      try {
        sessionStorage.setItem('pmesp_active_room', JSON.stringify({
          roomId: response.roomId,
          topic: state.currentRoomTopic,
          isHost: state.isHost,
          role: state.role,
          displayName: state.displayName,
          password: password
        }));
      } catch (e) {}

      // Aplica regras de permissão da interface
      applyRolePermissions();

      // Atualiza lista de participantes reais
      state.peers.clear();
      if (response.peers) {
        response.peers.forEach(p => state.peers.set(p.id, p));
      }

      // Se já há stream ativo e sou espectador, solicita stream do host
      if (response.hasActiveStream && !state.isHost) {
        setTimeout(async () => {
          await sendRequest('requestStream');
        }, 500);
      }

      // Atualiza URL no navegador para conter ?room=PMESP-XXX-X
      const newUrl = `${location.pathname}?room=${encodeURIComponent(roomId)}`;
      window.history.pushState({ roomId }, '', newUrl);

      // Transição de tela
      dom.viewLobby.classList.remove('active');
      dom.viewRoom.classList.add('active');

      dom.sessionRoomTopic.textContent = state.currentRoomTopic;
      dom.sessionRoomId.textContent = state.currentRoomId;

      startSessionTimer();
      renderPeerList();

      if (state.isHost) {
        showToast(`Sala conectada! Use o botão "Copiar Link da Sala" acima para convidar os alunos.`, 'ok', 6000);
      } else {
        showToast(`Você ingressou na sala como espectador.`, 'ok');
      }

    } catch (err) {
      console.error('[Join] Erro ao ingressar na sala:', err);
      if (err.message === 'SENHA_OBRIGATORIA') {
        if (dom.joinPasswordGroup) dom.joinPasswordGroup.style.display = 'block';
        if (dom.joinPassword) {
          dom.joinPassword.focus();
        }
        showToast('Esta sala é protegida por senha. Por favor, digite a senha de 4 dígitos para acessar.', 'warn', 6000);
      } else if (err.message === 'SENHA_INCORRETA') {
        if (dom.joinPasswordGroup) dom.joinPasswordGroup.style.display = 'block';
        if (dom.joinPassword) {
          dom.joinPassword.value = '';
          dom.joinPassword.focus();
        }
        showToast('Senha incorreta! Digite o PIN numérico de 4 dígitos configurado pelo instrutor.', 'error', 6000);
      } else {
        showToast(`Falha ao entrar na sala: ${err.message}`, 'error');
      }
      throw err;
    }
  }

  /**
   * Limpa o estado da sala ativa e retorna à visualização do lobby
   */
  async function exitRoomToLobby() {
    if (state.isBroadcasting) {
      await stopScreenSharing();
    }
    if (state.webcamStream) {
      state.webcamStream.getTracks().forEach(t => t.stop());
      state.webcamStream = null;
    }
    if (state.micStream) {
      state.micStream.getTracks().forEach(t => t.stop());
      state.micStream = null;
    }

    closeAllPeerConnections();

    // Limpa sessão persistida
    try {
      sessionStorage.removeItem('pmesp_active_room');
      if (state.currentRoomId) {
        localStorage.removeItem(`pmesp_host_token_${state.currentRoomId}`);
      }
    } catch (e) {}

    // Limpa estado local
    state.currentRoomId = null;
    state.peers.clear();
    state.isBroadcasting = false;
    state.isHost = false;

    stopSessionTimer();
    stopTelemetryStats();

    // Limpa URL
    window.history.pushState({}, '', location.pathname);

    // Retorna ao Lobby
    dom.viewRoom.classList.remove('active');
    dom.viewLobby.classList.add('active');
    dom.modalExit.classList.remove('active');

    // Restaura o lobby completo caso estivesse no modo isolado de convite
    showFullLobby();
    fetchRoomsList();
  }

  /**
   * Sair da sala como participante/espectador
   */
  async function leaveRoom() {
    try {
      await sendRequest('leave');
    } catch (err) {
      console.warn('[Leave] Erro ao notificar servidor:', err);
    }
    await exitRoomToLobby();
    showToast('Você saiu da sala.', 'info');
  }

  /**
   * Encerrar a aula em definitivo (exclusivo para o instrutor)
   */
  async function endRoomDefinitively() {
    try {
      showToast('Encerrando a aula para todos os participantes...', 'info');
      await sendRequest('endRoom');
      await exitRoomToLobby();
      showToast('Aula encerrada com sucesso e sala fechada em definitivo.', 'ok', 6000);
    } catch (err) {
      console.error('[EndRoom] Erro ao encerrar aula:', err);
      showToast(`Falha ao encerrar a aula: ${err.message}`, 'error');
      dom.modalExit.classList.remove('active');
    }
  }

  // ========================================================================
  // LISTA DE SALAS REAIS DO SERVIDOR
  // ========================================================================
  async function fetchRoomsList() {
    try {
      const response = await sendRequest('getRooms');
      const rooms = response.rooms || [];

      dom.activeRoomsCount.textContent = `${rooms.length} ativa${rooms.length === 1 ? '' : 's'}`;
      dom.roomsListContainer.innerHTML = '';

      if (rooms.length === 0) {
        dom.roomsListContainer.innerHTML = `
          <div class="empty-state">
            <span class="material-symbols-outlined" style="font-size: 36px; margin-bottom: 8px; display: block; color: var(--tertiary-container);">meeting_room</span>
            Nenhuma sala ativa no momento no servidor.<br>Crie uma sala acima para iniciar a transmissão.
          </div>
        `;
        return;
      }

      rooms.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'room-row';
        row.innerHTML = `
          <div class="room-info">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span class="room-title">${escapeHtml(r.topic)}</span>
              <span class="badge-tag ${r.hasActiveStream ? 'badge-live' : 'badge-idle'}">
                ${r.hasActiveStream ? '● AO VIVO' : 'DISPONÍVEL'}
              </span>
              ${r.hasPassword ? '<span class="badge-tag" style="background: rgba(255,180,170,0.15); color: #ffb3ac; border: 1px solid rgba(255,180,170,0.3);"><span class="material-symbols-outlined" style="font-size: 13px; vertical-align: middle;">lock</span> Com Senha</span>' : ''}
            </div>
            <div class="room-meta">
              <span class="mono" style="font-weight: 600; color: #fff;">${escapeHtml(r.id)}</span>
              <span>·</span>
              <span>${r.peersCount} participante${r.peersCount === 1 ? '' : 's'} real${r.peersCount === 1 ? '' : 'is'}</span>
            </div>
          </div>
          <div>
            <button class="btn-primary" style="padding: 8px 16px; font-size: 13px;" data-room-id="${escapeHtml(r.id)}">
              <span>Entrar</span>
              <span class="material-symbols-outlined" style="font-size: 16px;">chevron_right</span>
            </button>
          </div>
        `;

        row.querySelector('button').addEventListener('click', () => {
          const u = dom.inputJoinUsername.value.trim() || 'Operador Local';
          state.displayName = u;
          if (r.hasPassword) {
            dom.inputJoinCode.value = r.id;
            if (dom.joinPasswordGroup) dom.joinPasswordGroup.style.display = 'block';
            if (dom.joinPassword) {
              dom.joinPassword.value = '';
              dom.joinPassword.focus();
            }
            if (dom.cardJoinRoom) dom.cardJoinRoom.scrollIntoView({ behavior: 'smooth' });
            showToast(`A sala ${r.id} é protegida por senha. Digite o PIN de 4 dígitos e clique em Entrar.`, 'info');
          } else {
            joinRoom(r.id, r.topic, false, null);
          }
        });

        dom.roomsListContainer.appendChild(row);
      });

    } catch (err) {
      console.warn('[Rooms] Não foi possível obter lista de salas:', err);
    }
  }

  // ========================================================================
  // UTILITÁRIOS E UI
  // ========================================================================
  function updateConnectionIndicator(status) {
    if (status === 'connected') {
      dom.sfuStatusIcon.textContent = 'check_circle';
      dom.sfuStatusIcon.style.color = 'var(--status-ok)';
      dom.sfuStatusText.textContent = 'P2P Conectado';
    } else if (status === 'connecting') {
      dom.sfuStatusIcon.textContent = 'sync';
      dom.sfuStatusIcon.style.color = 'var(--status-warn)';
      dom.sfuStatusText.textContent = 'Conectando...';
    } else {
      dom.sfuStatusIcon.textContent = 'error';
      dom.sfuStatusIcon.style.color = 'var(--status-error)';
      dom.sfuStatusText.textContent = 'Desconectado';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ========================================================================
  // BINDING DE EVENTOS DA INTERFACE (DEFENSIVO & ROBUSTO)
  // ========================================================================
  function initEventBindings() {
    const on = (el, evt, fn) => {
      if (el) el.addEventListener(evt, fn);
    };

    // Botões do Lobby
    on(dom.btnCreateRoom, 'click', createAndJoinRoom);
    on(dom.btnJoinRoom, 'click', joinExistingRoom);
    on(dom.btnRefreshRooms, 'click', fetchRoomsList);

    // Botões de Compartilhar Link
    on(dom.btnCopyLink, 'click', copyInviteLink);
    on(dom.btnCopyInviteSidebar, 'click', copyInviteLink);

    // Atalhos de Teclado
    on(dom.inputJoinUsername, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        joinExistingRoom();
      }
    });

    on(dom.inputJoinCode, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (dom.inputJoinUsername) {
          dom.inputJoinUsername.focus();
          dom.inputJoinUsername.select();
        }
      }
    });

    on(dom.inputCreateUsername, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createAndJoinRoom();
      }
    });

    on(dom.inputCreateTopic, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (dom.inputCreateUsername) {
          dom.inputCreateUsername.focus();
          dom.inputCreateUsername.select();
        }
      }
    });

    // Iniciar Compartilhamento pelo Stage
    on(dom.btnStageStartShare, 'click', () => {
      if (dom.modalSettings) dom.modalSettings.classList.add('active');
    });

    // Controles Inferiores da Transmissão
    on(dom.btnCtrlScreen, 'click', () => {
      if (state.isBroadcasting) {
        stopScreenSharing();
      } else {
        if (dom.modalSettings) dom.modalSettings.classList.add('active');
      }
    });

    on(dom.btnCtrlCam, 'click', toggleWebcam);
    on(dom.btnCtrlMic, 'click', toggleMicrophone);

    on(dom.btnCtrlSettings, 'click', () => {
      if (dom.modalSettings) dom.modalSettings.classList.add('active');
    });

    on(dom.btnCtrlUsers, 'click', () => {
      if (dom.sidebarPanel) dom.sidebarPanel.classList.remove('collapsed');
      switchTab('tab-users');
      refreshRoomPeers();
    });

    on(dom.btnCtrlChat, 'click', () => {
      if (dom.sidebarPanel) dom.sidebarPanel.classList.remove('collapsed');
      switchTab('tab-chat');
    });

    on(dom.btnCtrlStats, 'click', () => {
      if (dom.sidebarPanel) dom.sidebarPanel.classList.remove('collapsed');
      switchTab('tab-telemetry');
    });

    on(dom.btnTogglePanel, 'click', () => {
      if (dom.sidebarPanel) dom.sidebarPanel.classList.toggle('collapsed');
    });

    // Senha de 4 dígitos - Toggle no card de criação
    if (dom.createRequirePassword) {
      const syncPasswordVisibility = () => {
        if (dom.createPasswordGroup) {
          dom.createPasswordGroup.style.display = dom.createRequirePassword.checked ? 'block' : 'none';
        }
        if (dom.createRequirePassword.checked && dom.createPassword) {
          dom.createPassword.focus();
        } else if (!dom.createRequirePassword.checked && dom.createPassword) {
          dom.createPassword.value = '';
        }
      };

      on(dom.createRequirePassword, 'change', syncPasswordVisibility);
      on(dom.createRequirePassword, 'click', syncPasswordVisibility);
      syncPasswordVisibility();
    }

    on(dom.createPassword, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createAndJoinRoom();
      }
    });

    on(dom.joinPassword, 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        joinExistingRoom();
      }
    });

    // Botão para ver lobby completo caso tenha entrado por link
    on(dom.btnShowCreateRoom, 'click', (e) => {
      e.preventDefault();
      showFullLobby();
    });

    // Chat
    on(dom.btnSendChat, 'click', sendChatMessage);
    on(dom.chatInput, 'keydown', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });

    // Abas do Painel Lateral
    if (dom.tabButtons) {
      dom.tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const tabId = btn.getAttribute('data-tab');
          switchTab(tabId);
          if (tabId === 'tab-users') {
            refreshRoomPeers();
          }
        });
      });
    }

    function switchTab(tabId) {
      if (dom.tabButtons) {
        dom.tabButtons.forEach(b => {
          if (b.getAttribute('data-tab') === tabId) b.classList.add('active');
          else b.classList.remove('active');
        });
      }

      if (dom.tabContents) {
        dom.tabContents.forEach(c => {
          if (c.id === tabId) c.classList.add('active');
          else c.classList.remove('active');
        });
      }
    }

    // Presets no Modal
    on(dom.presetCardMotion, 'click', () => {
      if (dom.presetCardMotion) dom.presetCardMotion.classList.add('selected');
      if (dom.presetCardDetail) dom.presetCardDetail.classList.remove('selected');
      state.preferences.preset = 'motion';
    });

    on(dom.presetCardDetail, 'click', () => {
      if (dom.presetCardDetail) dom.presetCardDetail.classList.add('selected');
      if (dom.presetCardMotion) dom.presetCardMotion.classList.remove('selected');
      state.preferences.preset = 'detail';
    });

    on(dom.btnModalCancel, 'click', () => {
      if (dom.modalSettings) dom.modalSettings.classList.remove('active');
    });

    on(dom.btnModalApply, 'click', async () => {
      if (dom.selectResolution) state.preferences.maxResolution = dom.selectResolution.value;
      if (dom.selectFps) state.preferences.maxFps = dom.selectFps.value;
      if (dom.checkSystemAudio) state.preferences.systemAudio = dom.checkSystemAudio.checked;

      if (dom.modalSettings) dom.modalSettings.classList.remove('active');

      if (!state.isBroadcasting) {
        await startScreenSharing();
      } else {
        showToast('Parâmetros salvos para a próxima transmissão.', 'ok');
      }
    });

    // Modal de Saída / Encerramento
    on(dom.btnCtrlExit, 'click', () => {
      if (state.isHost) {
        if (dom.modalExitIcon) {
          dom.modalExitIcon.textContent = 'power_settings_new';
          dom.modalExitIcon.style.color = 'var(--status-error)';
        }
        if (dom.modalExitTitle) dom.modalExitTitle.textContent = 'Encerrar a Aula Definitivamente?';
        if (dom.modalExitDesc) {
          dom.modalExitDesc.innerHTML = 'Atenção Instrutor: Ao encerrar a aula, a transmissão será finalizada, <strong>todos os participantes serão desconectados</strong> e a sala será fechada em definitivo no servidor.';
        }
        if (dom.btnExitConfirm) {
          dom.btnExitConfirm.innerHTML = '<span class="material-symbols-outlined">power_settings_new</span><span>Encerrar Aula para Todos</span>';
          dom.btnExitConfirm.style.backgroundColor = 'var(--status-error)';
        }
      } else {
        if (dom.modalExitIcon) {
          dom.modalExitIcon.textContent = 'logout';
          dom.modalExitIcon.style.color = 'var(--primary-container)';
        }
        if (dom.modalExitTitle) dom.modalExitTitle.textContent = 'Sair da Sala de Transmissão?';
        if (dom.modalExitDesc) {
          dom.modalExitDesc.textContent = 'Você será desconectado da sessão de instrução. Poderá retornar a qualquer momento se a aula ainda estiver aberta.';
        }
        if (dom.btnExitConfirm) {
          dom.btnExitConfirm.innerHTML = '<span class="material-symbols-outlined">logout</span><span>Confirmar Saída</span>';
          dom.btnExitConfirm.style.backgroundColor = 'var(--primary-container)';
        }
      }
      if (dom.modalExit) dom.modalExit.classList.add('active');
    });

    on(dom.btnExitCancel, 'click', () => {
      if (dom.modalExit) dom.modalExit.classList.remove('active');
    });

    on(dom.btnExitConfirm, 'click', () => {
      if (state.isHost) {
        endRoomDefinitively();
      } else {
        leaveRoom();
      }
    });

    // Desbloqueio Global de Áudio (Autoplay Policy do Navegador)
    document.addEventListener('click', unlockAudio, { passive: true });
    document.addEventListener('keydown', unlockAudio, { passive: true });
    on(dom.btnUnmuteAudio, 'click', (e) => {
      e.stopPropagation();
      unlockAudio();
    });
  }

  // ========================================================================
  // EXTRAÇÃO DE CÓDIGO DA SALA DA URL (QUERY PARAM, HASH OU PATH)
  // ========================================================================
  function getRoomFromUrl() {
    try {
      const search = window.location.search;
      if (search) {
        const urlParams = new URLSearchParams(search);
        const r = urlParams.get('room');
        if (r && r.trim()) return r.trim().toUpperCase();
      }

      const hash = window.location.hash;
      if (hash) {
        const cleanHash = hash.replace(/^[#/?]+/, '');
        if (cleanHash.indexOf('room=') !== -1) {
          const hp = new URLSearchParams(cleanHash.substring(cleanHash.indexOf('room=')));
          const hr = hp.get('room');
          if (hr && hr.trim()) return hr.trim().toUpperCase();
        }
        if (cleanHash.toUpperCase().startsWith('PMESP-')) {
          return cleanHash.trim().toUpperCase();
        }
      }

      const path = window.location.pathname;
      if (path) {
        const segments = path.split('/').filter(Boolean);
        for (const seg of segments) {
          if (seg.toUpperCase().startsWith('PMESP-')) {
            return seg.trim().toUpperCase();
          }
        }
      }
    } catch (e) {
      console.warn('[URL] Erro ao extrair sala da URL:', e);
    }
    return null;
  }

  // ========================================================================
  // ISOLAMENTO DE TELA AO ACESSAR VIA LINK DE CONVITE
  // ========================================================================
  async function isolateJoinView(roomId) {
    const cleanRoom = String(roomId || '').trim().toUpperCase();
    if (!cleanRoom) return;

    // Marca classe no <html> para ocultar imediatamente via CSS
    document.documentElement.classList.add('is-invite-view');

    // 1. Oculta o card de criar sala e a lista de salas públicas
    if (dom.cardCreateRoom) dom.cardCreateRoom.style.display = 'none';
    if (dom.roomsSection) dom.roomsSection.style.display = 'none';

    // 2. Centraliza o card de entrar na sala
    if (dom.cardJoinRoom) {
      dom.cardJoinRoom.classList.add('card-highlight');
      dom.cardJoinRoom.style.maxWidth = '520px';
      dom.cardJoinRoom.style.margin = '0 auto';
      dom.cardJoinRoom.style.gridColumn = '1 / -1';
    }

    // 3. Preenche e bloqueia o código da sala
    if (dom.inputJoinCode) {
      dom.inputJoinCode.value = cleanRoom;
      dom.inputJoinCode.readOnly = true;
      dom.inputJoinCode.style.opacity = '0.9';
      dom.inputJoinCode.style.backgroundColor = 'var(--surface-container-high)';
    }

    if (dom.joinCodeBadge) dom.joinCodeBadge.style.display = 'inline-block';
    if (dom.inviteBanner) dom.inviteBanner.style.display = 'flex';
    if (dom.inviteRoomCode) dom.inviteRoomCode.textContent = cleanRoom;
    if (dom.linkShowFullLobby) dom.linkShowFullLobby.style.display = 'block';

    const desc = document.getElementById('join-card-desc');
    if (desc) {
      desc.innerHTML = `Você foi convidado para a instrução na sala <strong style="color: #fff;">${escapeHtml(cleanRoom)}</strong>. Preencha seus dados para acessar.`;
    }

    // 4. Botão em destaque primário
    if (dom.btnJoinRoom) {
      dom.btnJoinRoom.classList.remove('btn-secondary');
      dom.btnJoinRoom.classList.add('btn-primary');
      dom.btnJoinRoom.innerHTML = `
        <span class="material-symbols-outlined">login</span>
        <span>Entrar na Instrução Agora</span>
      `;
    }

    // 5. Verifica se a sala existe e se requer senha de 4 dígitos
    try {
      const res = await fetch(`/api/room/${encodeURIComponent(cleanRoom)}`);
      if (res.ok) {
        const info = await res.json();
        if (info && info.hasPassword) {
          if (dom.joinPasswordGroup) dom.joinPasswordGroup.style.display = 'block';
          if (dom.joinPassword) {
            dom.joinPassword.placeholder = 'Digite a senha (4 números)';
          }
        }
      }
    } catch (e) {
      console.warn('[RoomInfo] Erro ao verificar senha da sala:', e);
    }

    // 6. Preenche identificação salva
    const savedName = localStorage.getItem('pmesp_user_name');
    if (savedName && dom.inputJoinUsername) {
      dom.inputJoinUsername.value = savedName;
      setTimeout(() => {
        if (dom.joinPasswordGroup && dom.joinPasswordGroup.style.display !== 'none' && dom.joinPassword) {
          dom.joinPassword.focus();
        } else if (dom.inputJoinUsername) {
          dom.inputJoinUsername.focus();
          dom.inputJoinUsername.select();
        }
      }, 300);
    } else if (dom.inputJoinUsername) {
      setTimeout(() => {
        dom.inputJoinUsername.focus();
      }, 300);
    }

    showToast(`Sala ${cleanRoom} identificada via link. Informe seus dados e clique em Entrar.`, 'info', 5000);
  }

  function showFullLobby() {
    document.documentElement.classList.remove('is-invite-view');
    if (dom.cardCreateRoom) dom.cardCreateRoom.style.display = '';
    if (dom.roomsSection) dom.roomsSection.style.display = '';
    if (dom.cardJoinRoom) {
      dom.cardJoinRoom.classList.remove('card-highlight');
      dom.cardJoinRoom.style.maxWidth = '';
      dom.cardJoinRoom.style.margin = '';
      dom.cardJoinRoom.style.gridColumn = '';
    }
    if (dom.inputJoinCode) {
      dom.inputJoinCode.readOnly = false;
      dom.inputJoinCode.value = '';
      dom.inputJoinCode.style.opacity = '';
      dom.inputJoinCode.style.backgroundColor = '';
    }
    if (dom.joinPasswordGroup) dom.joinPasswordGroup.style.display = 'none';
    if (dom.joinPassword) dom.joinPassword.value = '';
    if (dom.joinCodeBadge) dom.joinCodeBadge.style.display = 'none';
    if (dom.inviteBanner) dom.inviteBanner.style.display = 'none';
    if (dom.linkShowFullLobby) dom.linkShowFullLobby.style.display = 'none';

    const desc = document.getElementById('join-card-desc');
    if (desc) {
      desc.textContent = 'Acesse uma transmissão em andamento utilizando o link compartilhado pelo instrutor.';
    }

    if (dom.btnJoinRoom) {
      dom.btnJoinRoom.classList.remove('btn-primary');
      dom.btnJoinRoom.classList.add('btn-secondary');
      dom.btnJoinRoom.innerHTML = `
        <span class="material-symbols-outlined">login</span>
        <span>Entrar na Sala</span>
      `;
    }

    window.history.pushState({}, '', location.pathname);
    fetchRoomsList();
  }

  function checkUrlInvite() {
    const cleanRoom = getRoomFromUrl();
    if (cleanRoom) {
      isolateJoinView(cleanRoom);
    } else {
      document.documentElement.classList.remove('is-invite-view');
      const savedName = localStorage.getItem('pmesp_user_name');
      if (savedName) {
        if (dom.inputCreateUsername) dom.inputCreateUsername.value = savedName;
        if (dom.inputJoinUsername) dom.inputJoinUsername.value = savedName;
      }
    }
  }

  // ========================================================================
  // RESTAURAÇÃO DE SESSÃO PERSISTENTE (F5 / RELOAD) OU LINK DE CONVITE
  // ========================================================================
  async function checkActiveSessionOrInvite() {
    let activeSession = null;
    try {
      const raw = sessionStorage.getItem('pmesp_active_room');
      if (raw) activeSession = JSON.parse(raw);
    } catch (e) {}

    const urlRoom = getRoomFromUrl();

    // Caso 1: O usuário estava dentro de uma sala ativa antes do reload (F5)
    // OU o usuário possui o hostToken salvo para a sala da URL (instrutor criador)
    const targetRoom = (activeSession && activeSession.roomId)
      ? activeSession.roomId
      : (urlRoom && localStorage.getItem(`pmesp_host_token_${urlRoom}`) ? urlRoom : null);

    if (targetRoom) {
      const cleanRoom = targetRoom.trim().toUpperCase();
      const isSavedHost = activeSession ? Boolean(activeSession.isHost) : Boolean(localStorage.getItem(`pmesp_host_token_${cleanRoom}`));
      const topic = (activeSession && activeSession.topic) ? activeSession.topic : 'Instrução Operacional';
      const savedPass = (activeSession && activeSession.password) ? activeSession.password : null;
      const savedName = (activeSession && activeSession.displayName) || localStorage.getItem('pmesp_user_name') || (isSavedHost ? 'Instrutor Titular' : 'Operador Local');

      state.displayName = savedName;
      if (dom.headerUserDisplay) dom.headerUserDisplay.textContent = savedName;
      if (dom.headerUserAvatar) dom.headerUserAvatar.textContent = savedName.substring(0, 2).toUpperCase();

      try {
        console.log(`[Session] Restaurando sessão da sala ${cleanRoom} (Host: ${isSavedHost})...`);
        showToast(`Reconectando à sala ${cleanRoom}...`, 'info', 3000);
        await joinRoom(cleanRoom, topic, false, savedPass);
        return; // Reconexão concluída com sucesso!
      } catch (err) {
        console.warn('[Session] Não foi possível restaurar sessão anterior:', err);
        try {
          sessionStorage.removeItem('pmesp_active_room');
        } catch (e) {}
      }
    }

    // Caso 2: Não há sessão para restaurar. Processa como convite de URL ou lobby normal
    checkUrlInvite();
  }

  // ========================================================================
  // INICIALIZAÇÃO ROBUSTA
  // ========================================================================
  function initApp() {
    initEventBindings();
    connectWebSocket();
    checkActiveSessionOrInvite();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }

})();
