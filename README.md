# PMESP Stream | Compartilhamento de Tela & Instrução Continuada (WebRTC + SFU mediasoup)

Aplicação desenvolvida para transmissão e compartilhamento de tela em tempo real, inspirada na identidade visual **Vanguarda Institucional PMESP**, utilizando arquitetura **SFU (Selective Forwarding Unit)** com **mediasoup v3**, **getDisplayMedia()**, **WebRTC** e sinalização via **WebSocket**.

---

## 🏛️ Características e Tecnologias

### 1. Servidor SFU (mediasoup v3)
- **Topologia SFU**: Evita conexões P2P completas (*mesh*), permitindo que o transmissor envie apenas **uma única cópia do stream** de vídeo/áudio. O mediasoup distribui eficientemente para múltiplos espectadores na sala.
- **Worker nativo mediasoup**: Inicializado em processo de alta performance com portas RTP/RTCP dedicadas.
- **Codecs de Vídeo**: H.264 (Constrained Baseline e Main Profile 5.0 com aceleração por hardware) e VP8.
- **Codec de Áudio**: Opus (48 kHz, 2 canais estéreo) para máxima fidelidade sonora.
- **Tratamento de Perda de Pacotes & Congestionamento**: Suporte nativo a NACKs, PLI (*Picture Loss Indication*) e controle adaptativo de largura de banda (TWCC/REMB).

### 2. Captura de Tela Nativa (`getDisplayMedia`)
- **Resoluções**: Suporte a **1080p (Full HD)**, **720p (HD)** e **480p (SD)**.
- **Taxa de Quadros de até 60 FPS**: Presets configuráveis de 60 FPS, 30 FPS ou 15 FPS conforme o equipamento e rede.
- **Otimização de Conteúdo (`contentHint`)**:
  - `motion`: Otimizado para alta fluidez (jogos, simuladores 3D, reprodução de vídeo).
  - `detail`: Otimizado para nitidez cristalina (PDFs operacionais, código, planilhas e documentos técnicos).
- **Captura de Áudio do Sistema**: Suporte a áudio do sistema/aba operacional quando selecionado na caixa nativa do navegador.
- **Detecção de Desconexão Nativa (`track.onended`)**: Caso o usuário clique em "Interromper compartilhamento" na barra nativa do navegador, a aplicação detecta e encerra a transmissão no SFU de forma limpa.

### 3. Sinalização & Gerenciamento de Salas (WebSocket)
- Criação e ingresso de salas sem dados fictícios (apenas participantes reais conectados localmente).
- **Hierarquia de Papéis e Permissões**:
  - **Criador da Sala (Instrutor / Host)**:
    - Permissão exclusiva para iniciar e encerrar compartilhamento de tela.
    - Permissão exclusiva para ativar câmera e microfone.
    - Acesso aos presets de qualidade e configurações avançadas.
  - **Participantes que entram via Código ou Link (Espectadores)**:
    - Modo exclusivo de visualização (os botões de transmissão, câmera e microfone são ocultados e bloqueados com validação no backend).
    - Acesso total para assistir à transmissão de tela e áudio do sistema do instrutor.
    - Acesso total à aba **Dúvidas & Q&A** para enviar perguntas e comentários em tempo real.
    - Acesso à lista de presença e telemetria de rede.
- Presença em tempo real (`peerJoined`, `peerLeft`, `newProducer`, `producerClosed`).
- Chat e canal de perguntas operacionais em tempo real entre os membros da sala.

### 4. Telemetria WebRTC em Tempo Real (`getStats`)
Acompanhamento a cada 1 segundo no painel lateral de métricas:
- **FPS Real medido**
- **Resolução de captura** (largura × altura e proporção)
- **Bitrate ativo** (kbps)
- **Latência / RTT** (ms)
- **Perda de pacotes e NACKs** (%)
- **Jitter** (ms)
- **Codec e transporte** (H.264 / VP8 via UDP/TCP)

### 5. Resiliência de Conexão e STUN/TURN
- Servidores STUN públicos configurados (`stun:stun.l.google.com:19302`).
- Suporte a servidores TURN para ambientes corporativos com restrições de firewall/NAT estrito via variáveis de ambiente (`TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD`).

---

## 🚀 Como Executar

### 1. Iniciar o Servidor
```bash
npm start
```
O servidor iniciará em:
`http://localhost:3000`

### 2. Testar Múltiplos Usuários (Transmissor e Espectadores)
1. Abra o navegador em `http://localhost:3000`.
2. Clique em **"Criar Sala e Iniciar"** para criar uma sala institucional (ex: `PMESP-784-A`).
3. Clique em **"Transmitir"** ou **"Compartilhar Minha Tela"** e selecione as opções desejadas (ex: 60 FPS, 1080p, Modo Fluidez, Áudio do Sistema).
4. Abra uma segunda aba (ou janela anônima) em `http://localhost:3000` e informe o código da sala ou utilize o link gerado.
5. A segunda aba receberá a transmissão do SFU instantaneamente com telemetria ao vivo e o nome do participante real na lista de efetivo conectado.
