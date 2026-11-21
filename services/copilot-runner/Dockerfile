FROM node:22.23.1-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs ./
RUN mkdir -p /workspace && chown -R node:node /app /workspace

USER node
ENV NODE_ENV=production
ENV COPILOT_WORKSPACE_ROOT=/workspace
EXPOSE 8000
CMD ["npm", "start"]
