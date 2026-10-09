FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js customers.json ./
EXPOSE 5678
CMD ["node", "server.js"]
