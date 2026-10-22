# Imagem base oficial Node.js Debian Bookworm com ferramentas de build
FROM node:22-bookworm-slim

# Instala ferramentas essenciais para o mediasoup-worker nativo
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Diretório de trabalho
WORKDIR /app

# Copia manifestos de dependência
COPY package*.json ./

# Instala todas as dependências e compila os binários
RUN npm install

# Copia todo o código da aplicação
COPY . .

# Garante que o bundle do cliente WebRTC esteja gerado
RUN npm run bundle

# Configuração de portas (Hugging Face Spaces usa 7860 por padrão)
ENV PORT=7860
ENV NODE_ENV=production

EXPOSE 7860

# Inicializa o servidor SFU
CMD ["node", "server.js"]
