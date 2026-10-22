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

    // Identificação do Usuário Local
    peerId: 'peer-' + Math.random().toString(36).substring(2, 9),
    displayName: 'Operador Local',
    role: 'spectator', // 'host' ou 'spectator'
    isHost: false,
    creatorPeerId: null,

    // Sala Atual
    currentRoomId: null,
    currentRoomTopic: '',
    sessionStartTime: null,
    sessionTimerInterval: null,

    // WebRTC P2P
    iceServers: [],
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
    inputCreateTopic: document.getElementById('create-topic'),
    inputCreateUsername: document.getElementById('create-username'),
    btnCreateRoom: document.getElementById('btn-create-room'),
    inputJoinCode: document.getElementById('join-code'),
    inputJoinUsername: document.getElementById('join-username'),
    btnJoinRoom: document.getElementById('btn-join-room'),
    roomsListContainer: document.getElementById('rooms-list-container'),
    activeRoomsCount: document.getElementById('active-rooms-count'),
    btnRefreshRooms: document.getElementById('btn-refresh-rooms'),
    inviteBanner: document.getElementById('invite-banner'),
    inviteRoomCode: document.getElementById('invite-room-code'),
    joinCodeBadge: document.getElementById('join-code-badge'),
    cardJoinRoom: document.getElementById('card-join-room'),

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
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}`;

    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      console.log('[WS] Conectado ao servidor de sinalização');
      state.connected = true;
      updateConnectionIndicator('connected');
      fetchRoomsList();
    };

    state.ws.onclose = () => {
      console.warn('[WS] Conexão encerrada. Tentando reconectar em 2s...');
      state.connected = false;
      updateConnectionIndicator('disconnected');
      setTimeout(connectWebSocket, 2000);
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

  function sendRequest(type, data = {}) {
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
      // Host recebe pedido de stream de um novo espectador
      case 'viewerRequestsStream': {
        const { viewerPeerId } = notification;
        console.log('[P2P] Espectador solicitou stream:', viewerPeerId);
        if (state.isHost && state.isBroadcasting && state.screenStream) {
          await createOfferForViewer(viewerPeerId);
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
        showToast('Transmissão iniciada pelo instrutor.', 'ok');
        // Espectador solicita o stream
        if (!state.isHost) {
          await sendRequest('requestStream');
        }
        break;
      }

      // Notificação de que o host encerrou transmissão
      case 'streamStopped': {
        console.log('[P2P] Host encerrou transmissão.');
        showToast('Transmissão encerrada pelo instrutor.', 'info');
        closeAllPeerConnections();
        showWaitingState();
        break;
      }

      // Novo participante real conectado na sala
      case 'peerJoined': {
        const { peer } = notification;
        state.peers.set(peer.id, peer);
        renderPeerList();
        showToast(`${peer.displayName} ingressou na sala`, 'info');

        // Se sou host e estou transmitindo, envio stream para o novo viewer
        if (state.isHost && state.isBroadcasting && state.screenStream) {
          setTimeout(() => createOfferForViewer(peer.id), 500);
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
    }
  }

  // ========================================================================
  // WEBRTC PEER-TO-PEER: GERENCIAMENTO DE CONEXÕES
  // ========================================================================

  /**
   * Cria uma RTCPeerConnection para um peer específico
   */
  function createPeerConnection(remotePeerId) {
    // Fecha qualquer conexão existente com esse peer
    closePeerConnection(remotePeerId);

    const pc = new RTCPeerConnection({
      iceServers: state.iceServers
    });

    state.peerConnections.set(remotePeerId, pc);
    state.pendingCandidates.set(remotePeerId, []);

    // Envia ICE candidates via sinalização
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal('rtcIceCandidate', {
          targetPeerId: remotePeerId,
          candidate: event.candidate.toJSON()
        });
      }
    };

    // Log de estado da conexão
    pc.onconnectionstatechange = () => {
      console.log(`[P2P] Conexão com ${remotePeerId}: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        updateConnectionIndicator('connected');
      } else if (pc.connectionState === 'failed') {
        updateConnectionIndicator('error');
        showToast('Conexão P2P falhou. Tentando reconectar...', 'warn');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[P2P] ICE State com ${remotePeerId}: ${pc.iceConnectionState}`);
    };

    return pc;
  }

  /**
   * HOST: Cria offer e envia stream para um espectador específico
   */
  async function createOfferForViewer(viewerPeerId) {
    const pc = createPeerConnection(viewerPeerId);

    // Adiciona todas as tracks do stream ativo
    if (state.screenStream) {
      state.screenStream.getTracks().forEach(track => {
        pc.addTrack(track, state.screenStream);
      });
    }

    // Se tem microfone ativo, adiciona também
    if (state.micStream) {
      state.micStream.getTracks().forEach(track => {
        pc.addTrack(track, state.micStream);
      });
    }

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await sendRequest('rtcOffer', {
        targetPeerId: viewerPeerId,
        offer: pc.localDescription.toJSON()
      });

      console.log(`[P2P] Offer enviada para ${viewerPeerId}`);
    } catch (err) {
      console.error('[P2P] Erro ao criar offer:', err);
    }
  }

  /**
   * ESPECTADOR: Recebe offer do host, cria answer
   */
  async function handleIncomingOffer(fromPeerId, offer) {
    const pc = createPeerConnection(fromPeerId);

    // Configura handler para receber tracks remotas
    pc.ontrack = (event) => {
      console.log(`[P2P] Track recebida: ${event.track.kind} de ${fromPeerId}`);

      if (event.track.kind === 'video') {
        dom.remoteVideo.srcObject = event.streams[0] || new MediaStream([event.track]);
        dom.placeholderStage.style.display = 'none';
        dom.streamInfoBadge.style.display = 'flex';
        dom.liveIndicator.className = 'badge-pulse';
        dom.liveText.textContent = 'AO VIVO';

        // Inicia telemetria com a peer connection
        startTelemetryStats(pc);

        // Atualiza info quando os metadados do vídeo carregam
        dom.remoteVideo.onloadedmetadata = () => {
          const w = dom.remoteVideo.videoWidth;
          const h = dom.remoteVideo.videoHeight;
          dom.streamInfoText.textContent = `Transmissão Ativa: ${w}×${h}`;
        };
      } else if (event.track.kind === 'audio') {
        // Áudio do sistema ou microfone do host
        const audioStream = event.streams[0] || new MediaStream([event.track]);
        dom.remoteAudio.srcObject = audioStream;
        dom.remoteAudio.play().catch(e => console.log('Autoplay áudio bloqueado:', e));
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Aplica candidatos ICE pendentes
      const pending = state.pendingCandidates.get(fromPeerId) || [];
      for (const candidate of pending) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      state.pendingCandidates.set(fromPeerId, []);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await sendRequest('rtcAnswer', {
        targetPeerId: fromPeerId,
        answer: pc.localDescription.toJSON()
      });

      console.log(`[P2P] Answer enviada para ${fromPeerId}`);
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
      console.warn('[P2P] Nenhuma PeerConnection para', fromPeerId);
      return;
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      // Aplica candidatos ICE pendentes
      const pending = state.pendingCandidates.get(fromPeerId) || [];
      for (const candidate of pending) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      state.pendingCandidates.set(fromPeerId, []);

      console.log(`[P2P] Conexão estabelecida com ${fromPeerId}`);
    } catch (err) {
      console.error('[P2P] Erro ao processar answer:', err);
    }
  }

  /**
   * Processa ICE candidate recebido
   */
  async function handleIncomingIceCandidate(fromPeerId, candidate) {
    const pc = state.peerConnections.get(fromPeerId);

    if (!pc || !pc.remoteDescription) {
      // Armazena para aplicar depois
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
          sampleRate: 48000
        } : false
      };

      console.log('[ScreenShare] Solicitando getDisplayMedia com constraints:', displayConstraints);
      const stream = await navigator.mediaDevices.getDisplayMedia(displayConstraints);
      state.screenStream = stream;
      state.isBroadcasting = true;

      const videoTrack = stream.getVideoTracks()[0];
      const audioTracks = stream.getAudioTracks();

      // Ajusta contentHint para otimizar codificador
      if (videoTrack) {
        videoTrack.contentHint = isMotion ? 'motion' : 'detail';
        console.log(`[ScreenShare] contentHint definido como: "${videoTrack.contentHint}"`);

        // Detecta encerramento nativo pelo botão "Interromper compartilhamento" do navegador
        videoTrack.onended = () => {
          console.log('[ScreenShare] Compartilhamento interrompido pelo usuário no navegador.');
          stopScreenSharing();
          showToast('Compartilhamento de tela encerrado.', 'info');
        };
      }

      // Verificação amigável de áudio do sistema
      if (state.preferences.systemAudio && audioTracks.length === 0) {
        showToast('Áudio do sistema não compartilhado na janela selecionada. A transmissão seguirá com vídeo.', 'warn', 5000);
      } else if (audioTracks.length > 0) {
        showToast('Áudio do sistema capturado com sucesso.', 'ok');
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

      // Envia stream para todos os espectadores já conectados
      for (const [peerId, peer] of state.peers.entries()) {
        if (peerId !== state.peerId && peer.role !== 'host') {
          await createOfferForViewer(peerId);
        }
      }

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

        // Se estiver transmitindo, adiciona mic às conexões existentes
        if (state.isBroadcasting) {
          for (const [peerId, pc] of state.peerConnections.entries()) {
            stream.getTracks().forEach(track => {
              pc.addTrack(track, stream);
            });
          }
        }
      }
    } catch (err) {
      showToast(`Não foi possível acessar o microfone: ${err.message}`, 'error');
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
    } else {
      // Espectador: Apenas assistir e interagir na aba de dúvidas
      dom.hostMediaControls.style.display = 'none';
      dom.spectatorModeBadge.style.display = 'flex';

      dom.placeholderTitle.textContent = 'Aguardando o Instrutor';
      dom.placeholderDesc.textContent = 'Você ingressou como espectador. O criador da sala ainda não iniciou a transmissão. O vídeo aparecerá aqui automaticamente quando a aula começar. Você pode enviar suas dúvidas na aba lateral.';
      dom.btnStageStartShare.style.display = 'none';
      dom.placeholderIconSymbol.textContent = 'tv';

      dom.headerUserRole.textContent = 'Espectador / Participante';
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
  // CRONÔMETRO DA SESSÃO
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

    await joinRoom(roomId, topic, true);
  }

  async function joinExistingRoom() {
    const code = dom.inputJoinCode.value.trim().toUpperCase();
    const username = dom.inputJoinUsername.value.trim() || 'Operador Local';

    if (!code) {
      showToast('Por favor, informe o código da sala.', 'warn');
      dom.inputJoinCode.focus();
      return;
    }

    try {
      localStorage.setItem('pmesp_user_name', username);
    } catch (e) {}

    state.displayName = username;
    dom.headerUserDisplay.textContent = username;
    dom.headerUserAvatar.textContent = username.substring(0, 2).toUpperCase();

    await joinRoom(code, 'Instrução em Andamento', false);
  }

  // ========================================================================
  // COMPARTILHAMENTO DE LINK DA SALA
  // ========================================================================
  function copyInviteLink() {
    if (!state.currentRoomId) {
      showToast('Nenhuma sala ativa para compartilhar.', 'warn');
      return;
    }

    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(state.currentRoomId)}`;

    const onCopied = () => {
      if (dom.copyText) dom.copyText.textContent = 'Link Copiado! ✓';
      if (dom.copyTextSidebar) dom.copyTextSidebar.textContent = 'Link Copiado! ✓';
      showToast('Link da sala copiado! Envie este link aos alunos para que entrem diretamente.', 'ok', 5000);

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

  async function joinRoom(roomId, topic, isCreating = false) {
    try {
      showToast(`Conectando à sala ${roomId}...`, 'info');

      const response = await sendRequest('join', {
        roomId,
        peerId: state.peerId,
        displayName: state.displayName,
        isCreating: isCreating,
        topic
      });

      state.currentRoomId = response.roomId;
      state.currentRoomTopic = response.topic || topic;
      state.isHost = !!response.isHost;
      state.role = response.role || (state.isHost ? 'host' : 'spectator');
      state.creatorPeerId = response.creatorPeerId;
      state.iceServers = response.iceServers || [];

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
        showToast(`Sala criada com sucesso! Use o botão "Copiar Link da Sala" acima para convidar os alunos.`, 'ok', 6000);
      } else {
        showToast(`Você ingressou na sala como espectador.`, 'ok');
      }

    } catch (err) {
      console.error('[Join] Erro ao ingressar na sala:', err);
      showToast(`Falha ao entrar na sala: ${err.message}`, 'error');
    }
  }

  async function leaveRoom() {
    try {
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

      await sendRequest('leave');

      // Limpa estado local
      state.currentRoomId = null;
      state.peers.clear();
      state.isBroadcasting = false;

      stopSessionTimer();
      stopTelemetryStats();

      // Limpa URL
      window.history.pushState({}, '', location.pathname);

      // Retorna ao Lobby
      dom.viewRoom.classList.remove('active');
      dom.viewLobby.classList.add('active');
      dom.modalExit.classList.remove('active');

      fetchRoomsList();
      showToast('Você saiu da sala.', 'info');
    } catch (err) {
      console.error('[Leave] Erro ao sair:', err);
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
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="room-title">${escapeHtml(r.topic)}</span>
              <span class="badge-tag ${r.hasActiveStream ? 'badge-live' : 'badge-idle'}">
                ${r.hasActiveStream ? '● AO VIVO' : 'DISPONÍVEL'}
              </span>
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
          joinRoom(r.id, r.topic);
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
  // BINDING DE EVENTOS DA INTERFACE
  // ========================================================================
  function initEventBindings() {
    // Botões do Lobby
    dom.btnCreateRoom.addEventListener('click', createAndJoinRoom);
    dom.btnJoinRoom.addEventListener('click', joinExistingRoom);
    dom.btnRefreshRooms.addEventListener('click', fetchRoomsList);

    // Botões de Compartilhar Link
    if (dom.btnCopyLink) dom.btnCopyLink.addEventListener('click', copyInviteLink);
    if (dom.btnCopyInviteSidebar) dom.btnCopyInviteSidebar.addEventListener('click', copyInviteLink);

    // Atalhos de Teclado (Enter para entrar ou criar sala rapidamente)
    dom.inputJoinUsername.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        joinExistingRoom();
      }
    });

    dom.inputJoinCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        dom.inputJoinUsername.focus();
        dom.inputJoinUsername.select();
      }
    });

    dom.inputCreateUsername.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createAndJoinRoom();
      }
    });

    dom.inputCreateTopic.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        dom.inputCreateUsername.focus();
        dom.inputCreateUsername.select();
      }
    });

    // Iniciar Compartilhamento pelo Stage
    dom.btnStageStartShare.addEventListener('click', () => {
      dom.modalSettings.classList.add('active');
    });

    // Controles Inferiores
    dom.btnCtrlScreen.addEventListener('click', () => {
      if (state.isBroadcasting) {
        stopScreenSharing();
      } else {
        dom.modalSettings.classList.add('active');
      }
    });

    dom.btnCtrlCam.addEventListener('click', toggleWebcam);
    dom.btnCtrlMic.addEventListener('click', toggleMicrophone);

    dom.btnCtrlSettings.addEventListener('click', () => {
      dom.modalSettings.classList.add('active');
    });

    dom.btnCtrlUsers.addEventListener('click', () => {
      dom.sidebarPanel.classList.remove('collapsed');
      switchTab('tab-users');
    });

    dom.btnCtrlChat.addEventListener('click', () => {
      dom.sidebarPanel.classList.remove('collapsed');
      switchTab('tab-chat');
    });

    dom.btnCtrlStats.addEventListener('click', () => {
      dom.sidebarPanel.classList.remove('collapsed');
      switchTab('tab-telemetry');
    });

    dom.btnTogglePanel.addEventListener('click', () => {
      dom.sidebarPanel.classList.toggle('collapsed');
    });

    dom.btnCtrlExit.addEventListener('click', () => {
      dom.modalExit.classList.add('active');
    });

    // Chat
    dom.btnSendChat.addEventListener('click', sendChatMessage);
    dom.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChatMessage();
    });

    // Abas do Painel Lateral
    dom.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        switchTab(tabId);
      });
    });

    function switchTab(tabId) {
      dom.tabButtons.forEach(b => {
        if (b.getAttribute('data-tab') === tabId) b.classList.add('active');
        else b.classList.remove('active');
      });

      dom.tabContents.forEach(c => {
        if (c.id === tabId) c.classList.add('active');
        else c.classList.remove('active');
      });
    }

    // Presets no Modal
    dom.presetCardMotion.addEventListener('click', () => {
      dom.presetCardMotion.classList.add('selected');
      dom.presetCardDetail.classList.remove('selected');
      state.preferences.preset = 'motion';
    });

    dom.presetCardDetail.addEventListener('click', () => {
      dom.presetCardDetail.classList.add('selected');
      dom.presetCardMotion.classList.remove('selected');
      state.preferences.preset = 'detail';
    });

    dom.btnModalCancel.addEventListener('click', () => {
      dom.modalSettings.classList.remove('active');
    });

    dom.btnModalApply.addEventListener('click', async () => {
      state.preferences.maxResolution = dom.selectResolution.value;
      state.preferences.maxFps = dom.selectFps.value;
      state.preferences.systemAudio = dom.checkSystemAudio.checked;

      dom.modalSettings.classList.remove('active');

      // Se ainda não estiver compartilhando tela, inicia
      if (!state.isBroadcasting) {
        await startScreenSharing();
      } else {
        showToast('Parâmetros salvos para a próxima transmissão.', 'ok');
      }
    });

    // Modal de Saída
    dom.btnExitCancel.addEventListener('click', () => {
      dom.modalExit.classList.remove('active');
    });

    dom.btnExitConfirm.addEventListener('click', leaveRoom);

    // Detecção de parâmetro de URL (?room=PMESP-XXX-X)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      const cleanRoom = roomParam.trim().toUpperCase();
      dom.inputJoinCode.value = cleanRoom;
      dom.inputJoinCode.readOnly = true;
      dom.inputJoinCode.style.opacity = '0.9';
      dom.inputJoinCode.style.backgroundColor = 'var(--surface-container-high)';

      if (dom.inviteBanner) dom.inviteBanner.style.display = 'flex';
      if (dom.inviteRoomCode) dom.inviteRoomCode.textContent = cleanRoom;
      if (dom.joinCodeBadge) dom.joinCodeBadge.style.display = 'inline-block';
      if (dom.cardJoinRoom) dom.cardJoinRoom.classList.add('card-highlight');

      // Tenta recuperar o último nome utilizado pelo aluno
      const savedName = localStorage.getItem('pmesp_user_name');
      if (savedName) {
        dom.inputJoinUsername.value = savedName;
      } else {
        dom.inputJoinUsername.value = '';
      }

      // Foca automaticamente no campo de nome para o usuário só digitar
      setTimeout(() => {
        dom.inputJoinUsername.focus();
        dom.inputJoinUsername.select();
      }, 250);

      // Transforma o botão para destaque primário com texto claro
      dom.btnJoinRoom.classList.remove('btn-secondary');
      dom.btnJoinRoom.classList.add('btn-primary');
      dom.btnJoinRoom.innerHTML = `
        <span class="material-symbols-outlined">login</span>
        <span>Entrar na Instrução Agora</span>
      `;

      showToast(`Convite para a sala ${cleanRoom} identificado. Digite seu nome e clique em Entrar.`, 'info', 5000);
    } else {
      // Se não veio por convite, carrega o nome salvo se existir
      const savedName = localStorage.getItem('pmesp_user_name');
      if (savedName) {
        dom.inputCreateUsername.value = savedName;
        dom.inputJoinUsername.value = savedName;
      }
    }
  }

  // ========================================================================
  // INICIALIZAÇÃO
  // ========================================================================
  window.addEventListener('DOMContentLoaded', () => {
    initEventBindings();
    connectWebSocket();
  });

})();
