# Final Production Server (Express API only)
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
WORKDIR /app

# Install backend dependencies
# We copy from the 'backend' folder at the root
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy backend source code
COPY --chown=node:node backend/src ./src
USER node

# Environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Container hosts may inject their assigned PORT.
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health/live',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Start the API server - the main file is in src/server.js
CMD ["node", "src/server.js"]
