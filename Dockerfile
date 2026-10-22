# Ubuntu 22.04 é idêntico ao ambiente onde o mediasoup compila os binários
# pré-compilados oficiais (via GitHub Actions), garantindo compatibilidade total
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Instala Node.js 22 via NodeSource + ferramentas de build (pip, g++, make)
# necessárias caso o prebuilt falhe e precise compilar localmente
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    python3 \
    python3-pip \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia manifestos de dependências
COPY package*.json ./

# Instala dependências (mediasoup prebuilt roda direto no Ubuntu 22.04)
RUN npm install

# Copia código-fonte da aplicação
COPY . .

# Gerar bundle do cliente mediasoup
RUN npm run bundle

# Porta padrão do Render
ENV PORT=10000
ENV NODE_ENV=production

EXPOSE 10000

# Iniciar servidor
CMD ["node", "server.js"]
