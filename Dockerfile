FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

RUN mkdir -p /app/recordings

EXPOSE 3000

CMD ["node", "server.js"]