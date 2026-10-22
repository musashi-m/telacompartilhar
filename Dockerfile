FROM node:20-bullseye-slim

# Instalar dependências de compilação necessárias para o worker C++ do mediasoup
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar manifests de pacotes
COPY package*.json ./

# Instalar dependências
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
