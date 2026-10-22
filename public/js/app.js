/**
 * PMESP STREAM - APLICAÇÃO DE COMPARTILHAMENTO DE TELA & INSTRUÇÃO WEBRTC
 * Arquitetura SFU mediasoup v3 com getDisplayMedia e sinalização WebSocket
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

    // Mediasoup
    device: null,
    sendTransport: null,
    recvTransport: null,
    producers: new Map(), // mediaType -> producer
    consumers: new Map(), // consumerId -> consumer

    // Streams Locais
    screenStream: null,
    webcamStream: null,
    micStream: null,

    // Preferências de Transmissão
    preferences: {
      preset: 'motion', // 'motion' (60 FPS jogos/vídeos) ou 'detail' (documentos/texto)
      maxResolution: '1080',
      maxFps: '60',
      systemAudio: true
    },

    // Participantes e Mensagens Reais
    peers: new Map(), // peerId -> { id, displayName, role }
    activeBroadcasterPeerId: null,

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

    // Sala Sub-header
    sessionRoomTopic: document.getElementById('session-room-topic'),
    sessionRoomId: document.getElementById('session-room-id'),
    btnCopyLink: document.getElementById('btn-copy-link'),
    copyText: document.getElementById('copy-text'),
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
      updateSfuIndicator('connected');
      fetchRoomsList();
    };

    state.ws.onclose = () => {
      console.warn('[WS] Conexão encerrada. Tentando reconectar em 2s...');
      state.connected = false;
      updateSfuIndicator('disconnected');
      setTimeout(connectWebSocket, 2000);
    };

    state.ws.onerror = (err) => {
      console.error('[WS] Erro de socket:', err);
      updateSfuIndicator('error');
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

  // ========================================================================
  // PROCESSAMENTO DE NOTIFICAÇÕES DO SERVIDOR
  // ========================================================================
  async function handleServerNotification(notification) {
    const { event } = notification;

    switch (event) {
      // Novo produtor na sala (compartilhamento iniciado por outro peer)
      case 'newProducer': {
        const { producer } = notification;
        console.log('[SFU] Novo produtor na sala:', producer);
        showToast(`Novo stream disponível: ${producer.appData?.mediaType || producer.kind}`, 'info');
        await consumeRemoteProducer(producer);
        break;
      }

      // Produtor fechado (compartilhamento encerrado)
      case 'producerClosed': {
        const { producerId } = notification;
        console.log('[SFU] Produtor encerrado:', producerId);
        handleProducerClosed(producerId);
        break;
      }

      // Novo participante real conectado na sala
      case 'peerJoined': {
        const { peer } = notification;
        state.peers.set(peer.id, peer);
        renderPeerList();
        showToast(`${peer.displayName} ingressou na sala`, 'info');
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
        break;
      }

      // Mensagem de Chat / Dúvidas em tempo real
      case 'chatMessage': {
        const { message } = notification;
        appendChatMessage(message);
        break;
      }

      case 'consumerClosed': {
        const { consumerId } = notification;
        if (state.consumers.has(consumerId)) {
          const consumer = state.consumers.get(consumerId);
          consumer.close();
          state.consumers.delete(consumerId);
          checkActiveStreams();
        }
        break;
      }
    }
  }

  // ========================================================================
  // INICIALIZAÇÃO MEDIASOUP DEVICE & TRANSPORTS
  // ========================================================================
  async function initMediasoupDevice(routerRtpCapabilities) {
    if (!window.mediasoupClient) {
      throw new Error('Biblioteca mediasoup-client não carregada.');
    }

    state.device = new window.mediasoupClient.Device();
    await state.device.load({ routerRtpCapabilities });
    console.log('[SFU] mediasoup Device carregado com RTP Capabilities com sucesso.');
  }

  async function createSendTransport() {
    if (state.sendTransport) return state.sendTransport;

    const data = await sendRequest('createWebRtcTransport', { direction: 'send' });
    const transport = state.device.createSendTransport(data);

    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await sendRequest('connectWebRtcTransport', {
          transportId: transport.id,
          dtlsParameters
        });
        callback();
      } catch (err) {
        errback(err);
      }
    });

    transport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
      try {
        const { id } = await sendRequest('produce', {
          transportId: transport.id,
          kind,
          rtpParameters,
          appData
        });
        callback({ id });
      } catch (err) {
        errback(err);
      }
    });

    transport.on('connectionstatechange', (s) => {
      console.log(`[SendTransport] Estado: ${s}`);
      updateSfuIndicator(s);
    });

    state.sendTransport = transport;
    return transport;
  }

  async function createRecvTransport() {
    if (state.recvTransport) return state.recvTransport;

    const data = await sendRequest('createWebRtcTransport', { direction: 'recv' });
    const transport = state.device.createRecvTransport(data);

    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await sendRequest('connectWebRtcTransport', {
          transportId: transport.id,
          dtlsParameters
        });
        callback();
      } catch (err) {
        errback(err);
      }
    });

    transport.on('connectionstatechange', (s) => {
      console.log(`[RecvTransport] Estado: ${s}`);
      updateSfuIndicator(s);
    });

    state.recvTransport = transport;
    return transport;
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

      const videoTrack = stream.getVideoTracks()[0];
      const audioTracks = stream.getAudioTracks();

      // Ajusta contentHint para otimizar codificador (motion para jogos/vídeos ou detail para texto)
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

      // Cria transporte de envio mediasoup
      const transport = await createSendTransport();

      // Encodings com bitrate adaptativo para estabilidade
      const encodings = [
        {
          maxBitrate: isMotion ? 4500000 : 2500000,
          scaleResolutionDownBy: 1,
          maxFramerate: targetFps
        }
      ];

      // Produz a faixa de vídeo no SFU
      const videoProducer = await transport.produce({
        track: videoTrack,
        encodings,
        codecOptions: {
          videoGoogleStartBitrate: 2000
        },
        appData: {
          mediaType: 'screen-video',
          resolution: `${widthTarget}p`,
          fps: targetFps,
          mode: isMotion ? 'motion' : 'detail'
        }
      });
      state.producers.set('screen-video', videoProducer);

      // Produz o áudio do sistema se disponível
      if (audioTracks.length > 0) {
        const audioProducer = await transport.produce({
          track: audioTracks[0],
          codecOptions: {
            opusStereo: true,
            opusDtx: true
          },
          appData: { mediaType: 'screen-audio' }
        });
        state.producers.set('screen-audio', audioProducer);
      }

      // Atualiza interface do apresentador
      state.role = 'broadcaster';
      dom.remoteVideo.srcObject = stream;
      dom.remoteVideo.muted = true; // muta no host para evitar microfonia/eco local
      dom.placeholderStage.style.display = 'none';
      dom.streamInfoBadge.style.display = 'flex';
      dom.streamInfoText.textContent = `Você está transmitindo: ${widthTarget}p @ ${targetFps} FPS (${isMotion ? 'Fluidez' : 'Nitidez'})`;

      dom.btnCtrlScreen.classList.add('active');
      dom.labelCtrlScreen.textContent = 'Parar Tela';
      dom.liveIndicator.className = 'badge-pulse';
      dom.liveText.textContent = 'AO VIVO';

      showToast('Transmissão de tela iniciada com sucesso via SFU.', 'ok');
      startTelemetryStats(videoProducer);
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

    const videoProd = state.producers.get('screen-video');
    if (videoProd) {
      await sendRequest('closeProducer', { producerId: videoProd.id });
      videoProd.close();
      state.producers.delete('screen-video');
    }

    const audioProd = state.producers.get('screen-audio');
    if (audioProd) {
      await sendRequest('closeProducer', { producerId: audioProd.id });
      audioProd.close();
      state.producers.delete('screen-audio');
    }

    // Restaura interface
    dom.remoteVideo.srcObject = null;
    dom.streamInfoBadge.style.display = 'none';
    dom.btnCtrlScreen.classList.remove('active');
    dom.labelCtrlScreen.textContent = 'Transmitir';

    checkActiveStreams();
    renderPeerList();
  }

  // ========================================================================
  // CONSUMO DE STREAMS REMOTOS (ESPECTADORES)
  // ========================================================================
  async function consumeRemoteProducer(producer) {
    try {
      if (!state.device) {
        console.warn('[SFU] Dispositivo ainda não pronto para consumir.');
        return;
      }

      // Não consome se for o próprio stream enviado localmente
      if (producer.peerId === state.peerId) {
        return;
      }

      const transport = await createRecvTransport();

      const response = await sendRequest('consume', {
        producerId: producer.id,
        rtpCapabilities: state.device.rtpCapabilities
      });

      const { id, kind, rtpParameters, appData } = response;

      const consumer = await transport.consume({
        id,
        producerId: producer.id,
        kind,
        rtpParameters,
        appData
      });

      state.consumers.set(consumer.id, consumer);

      // Ativa o consumer no servidor
      await sendRequest('resumeConsumer', { consumerId: consumer.id });

      const stream = new MediaStream([consumer.track]);

      if (kind === 'video') {
        dom.remoteVideo.srcObject = stream;
        dom.remoteVideo.muted = false;
        dom.placeholderStage.style.display = 'none';
        dom.streamInfoBadge.style.display = 'flex';
        
        const res = appData?.resolution || 'HD';
        const fps = appData?.fps ? `${appData.fps} FPS` : '60 FPS';
        dom.streamInfoText.textContent = `Transmissão Ativa: ${res} @ ${fps}`;
        
        dom.liveIndicator.className = 'badge-pulse';
        dom.liveText.textContent = 'AO VIVO';

        startTelemetryStats(consumer);
      } else if (kind === 'audio') {
        dom.remoteAudio.srcObject = stream;
        dom.remoteAudio.play().catch(e => console.log('Autoplay áudio bloqueado até interação:', e));
      }

      console.log(`[SFU] Consumindo producer ${producer.id} [${kind}] com sucesso.`);
    } catch (err) {
      console.error('[SFU] Erro ao consumir stream remoto:', err);
    }
  }

  function handleProducerClosed(producerId) {
    for (const [cId, consumer] of state.consumers.entries()) {
      if (consumer.producerId === producerId) {
        consumer.close();
        state.consumers.delete(cId);
        break;
      }
    }
    checkActiveStreams();
  }

  function checkActiveStreams() {
    let hasRemoteVideo = false;
    for (const consumer of state.consumers.values()) {
      if (consumer.kind === 'video') {
        hasRemoteVideo = true;
        break;
      }
    }

    const hasLocalScreen = state.producers.has('screen-video');

    if (!hasRemoteVideo && !hasLocalScreen) {
      dom.remoteVideo.srcObject = null;
      dom.placeholderStage.style.display = 'flex';
      dom.streamInfoBadge.style.display = 'none';
      dom.liveIndicator.className = 'badge-tag badge-idle';
      dom.liveText.textContent = 'EM ESPERA';
      stopTelemetryStats();
    }
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
      }
    } catch (err) {
      showToast(`Não foi possível acessar o microfone: ${err.message}`, 'error');
    }
  }

  // ========================================================================
  // TELEMETRIA E DIAGNÓSTICO WEBRTC EM TEMPO REAL (getStats)
  // ========================================================================
  function startTelemetryStats(entity) {
    stopTelemetryStats();
    state.lastBytes = 0;
    state.lastStatsTimestamp = 0;

    state.statsInterval = setInterval(async () => {
      try {
        if (!entity || entity.closed) return;

        const stats = await entity.getStats();
        let fps = 0;
        let width = 0;
        let height = 0;
        let bitrate = 0;
        let rtt = 0;
        let jitter = 0;
        let packetsLost = 0;
        let totalPackets = 0;
        let codec = 'H.264 / VP8 (Hardware)';
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
        else if (width > 0) dom.statFps.textContent = '60 FPS';

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
          dom.statRttStatus.textContent = rtt < 40 ? 'Excelente (Localhost)' : 'Estável';
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
    const isTransmitting = state.producers.has('screen-video');
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
      return;
    }

    state.displayName = username;
    dom.headerUserDisplay.textContent = username;
    dom.headerUserAvatar.textContent = username.substring(0, 2).toUpperCase();

    await joinRoom(code, 'Instrução em Andamento', false);
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

      // Aplica regras de permissão da interface
      applyRolePermissions();

      // Inicializa dispositivo mediasoup
      await initMediasoupDevice(response.routerRtpCapabilities);

      // Atualiza lista de participantes reais
      state.peers.clear();
      if (response.peers) {
        response.peers.forEach(p => state.peers.set(p.id, p));
      }

      // Se houver produtores ativos, consome imediatamente
      if (response.producers && response.producers.length > 0) {
        for (const prod of response.producers) {
          await consumeRemoteProducer(prod);
        }
      }

      // Atualiza URL sem recarregar para facilitar compartilhamento de link local
      const newUrl = `${location.pathname}?room=${roomId}`;
      window.history.pushState({ roomId }, '', newUrl);

      // Transição de tela
      dom.viewLobby.classList.remove('active');
      dom.viewRoom.classList.add('active');

      dom.sessionRoomTopic.textContent = state.currentRoomTopic;
      dom.sessionRoomId.textContent = state.currentRoomId;

      startSessionTimer();
      renderPeerList();
      showToast(state.isHost ? `Sala criada! Você é o instrutor da sessão.` : `Você ingressou como espectador.`, 'ok');

    } catch (err) {
      console.error('[Join] Erro ao ingressar na sala:', err);
      showToast(`Falha ao entrar na sala: ${err.message}`, 'error');
    }
  }

  async function leaveRoom() {
    try {
      if (state.screenStream) {
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

      await sendRequest('leave');

      // Limpa estado local
      state.currentRoomId = null;
      state.peers.clear();
      state.producers.clear();
      state.consumers.clear();
      if (state.sendTransport) {
        state.sendTransport.close();
        state.sendTransport = null;
      }
      if (state.recvTransport) {
        state.recvTransport.close();
        state.recvTransport = null;
      }

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
            Nenhuma sala ativa no momento no servidor local.<br>Crie uma sala acima para iniciar a transmissão.
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
  function updateSfuIndicator(status) {
    if (status === 'connected') {
      dom.sfuStatusIcon.textContent = 'check_circle';
      dom.sfuStatusIcon.style.color = 'var(--status-ok)';
      dom.sfuStatusText.textContent = 'SFU Conectado';
    } else if (status === 'connecting') {
      dom.sfuStatusIcon.textContent = 'sync';
      dom.sfuStatusIcon.style.color = 'var(--status-warn)';
      dom.sfuStatusText.textContent = 'Sincronizando...';
    } else {
      dom.sfuStatusIcon.textContent = 'error';
      dom.sfuStatusIcon.style.color = 'var(--status-error)';
      dom.sfuStatusText.textContent = 'SFU Oscilando';
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

    // Copiar Código da Sala
    dom.btnCopyLink.addEventListener('click', () => {
      const text = state.currentRoomId;
      navigator.clipboard.writeText(text).then(() => {
        dom.copyText.textContent = 'Copiado!';
        setTimeout(() => dom.copyText.textContent = 'Copiar Código', 2000);
      });
    });

    // Iniciar Compartilhamento pelo Stage
    dom.btnStageStartShare.addEventListener('click', () => {
      dom.modalSettings.classList.add('active');
    });

    // Controles Inferiores
    dom.btnCtrlScreen.addEventListener('click', () => {
      if (state.producers.has('screen-video')) {
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
      if (!state.producers.has('screen-video')) {
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
      dom.inputJoinCode.value = roomParam;
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
