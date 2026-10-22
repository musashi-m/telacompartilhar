const os = require('os');

module.exports = {
  // Configuração do Servidor Web e WebSocket
  http: {
    port: process.env.PORT || 3000,
    host: '0.0.0.0'
  },

  // Configuração do Servidor SFU mediasoup
  mediasoup: {
    // Número de workers (1 costuma ser ideal para desktop/localhost)
    numWorkers: Math.min(Object.keys(os.cpus()).length, 2),
    
    // Configurações do Worker
    workerSettings: {
      logLevel: 'warn',
      logTags: [
        'info',
        'ice',
        'dtls',
        'rtp',
        'srtp',
        'rtcp'
      ],
      rtcMinPort: Number(process.env.MEDIASOUP_MIN_PORT) || 20000,
      rtcMaxPort: Number(process.env.MEDIASOUP_MAX_PORT) || 20100
    },

    // Codecs de mídia suportados pelo Router SFU
    routerOptions: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 2000
          }
        },
        {
          kind: 'video',
          mimeType: 'video/H264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f', // Constrained Baseline Profile, Level 3.1
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 2500
          }
        },
        {
          kind: 'video',
          mimeType: 'video/H264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032', // Main Profile, Level 5.0 (suporte a 1080p60)
            'level-asymmetry-allowed': 1
          }
        }
      ]
    },

    // Configuração dos WebRtcTransports (produtores e consumidores)
    webRtcTransportOptions: {
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1'
        }
      ],
      initialAvailableOutgoingBitrate: 3000000, // 3 Mbps inicial para acomodar 1080p60
      minimumAvailableOutgoingBitrate: 300000,  // 300 kbps mínimo
      maxSctpMessageSize: 262144,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true
    }
  },

  // STUN & TURN
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    ...(process.env.TURN_URL ? [{
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_PASSWORD || ''
    }] : [])
  ]
};
