FROM node:22-bookworm-slim
ENV HOST=0.0.0.0 PORT=4173 DATA_DIR=/data NODE_ENV=development
WORKDIR /opt/stratum
COPY --chown=node:node . .
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4173
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
