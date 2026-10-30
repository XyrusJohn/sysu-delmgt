# backend/Dockerfile
# Node.js 24: matches the verified backend runtime
# Railway auto-detects this and uses it instead of nixpacks
FROM node:24-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install locked runtime dependencies only
RUN npm ci --omit=dev

# Copy application code
COPY --chown=node:node . .

ENV NODE_ENV=production \
    PORT=8080

# Container port is configurable for hosts that don't inject PORT.
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

USER node

# Start the server
CMD ["node", "server.js"]
