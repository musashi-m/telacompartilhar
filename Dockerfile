FROM node:22

WORKDIR /app

# Copiar manifests de dependências
COPY package*.json ./

# Instalação rápida: a imagem completa node:22 já inclui todas as libs C++ e Python,
# permitindo que o mediasoup execute o binário pré-compilado oficial instantaneamente
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
