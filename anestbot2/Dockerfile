FROM node:20-slim
RUN apt-get update && apt-get install -y ghostscript imagemagick --no-install-recommends && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
CMD ["node", "src/index.js"]
