FROM node:20-slim
RUN apt-get update && apt-get install -y ghostscript --no-install-recommends && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
CMD ["node", "src/index.js"]
