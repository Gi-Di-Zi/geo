FROM node:24.19.0-bookworm-slim
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.source="https://github.com/Gi-Di-Zi/geo" org.opencontainers.image.revision=$SOURCE_COMMIT
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 MCP_LOCAL_PATHS=0
WORKDIR /app
COPY --chown=node:node .output/ ./.output/
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
