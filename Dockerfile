FROM node:20-alpine

WORKDIR /app

# Instalar dependências de produção
COPY package*.json ./
RUN npm install --omit=dev

# Copiar arquivos da aplicação
COPY . .

# Configurações de ambiente do Render
ENV PORT=10000
ENV NODE_ENV=production

EXPOSE 10000

# Inicialização
CMD ["node", "server.js"]
