FROM node:22-bookworm-slim

# Instalar dependências necessárias para o mediasoup compilar seu worker nativo
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    make \
    g++ \
    gcc \
    ca-certificates \
    && rm -f /usr/lib/python3.*/EXTERNALLY-MANAGED \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar manifests de pacotes
COPY package*.json ./

# Instalar dependências (compatível com Node 22+)
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
