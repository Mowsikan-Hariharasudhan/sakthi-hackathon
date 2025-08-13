# Railway-compatible Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production || npm install --omit=dev
COPY . .
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server.js"]
