FROM node:22-bookworm-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
RUN mkdir -p /workspace && chown -R node:node /app /workspace

USER node
ENV NODE_ENV=production
ENV COPILOT_WORKSPACE_ROOT=/workspace
EXPOSE 8000
CMD ["npm", "start"]
