FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN npx tsx --version
EXPOSE 3001
CMD ["npx", "tsx", "src/index.ts"]
