FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Instalar dependências básicas, certificados e Node.js 22
# O Ubuntu 22.04 é o ambiente oficial no qual os binários pré-compilados do mediasoup-worker são gerados
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    python3 \
    python3-pip \
    make \
    g++ \
    gcc \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar manifests de dependências
COPY package*.json ./

# Instalar dependências (o binário pré-compilado do mediasoup roda nativamente no Ubuntu 22.04)
RUN npm install

# Copiar código-fonte da aplicação
COPY . .

# Gerar bundle do cliente mediasoup
RUN npm run bundle

# Porta padrão do Render
ENV PORT=10000
EXPOSE 10000

# Iniciar servidor
CMD ["node", "server.js"]
