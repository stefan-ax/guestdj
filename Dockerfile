# Build stage for React client
FROM node:18-alpine AS client-build

WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Production stage
FROM node:18-alpine

WORKDIR /app

# Copy server files
COPY package*.json ./
RUN npm install --production

COPY server/ ./server/

# Copy built client
COPY --from=client-build /app/client/build ./client/build

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["node", "server/index.js"]
