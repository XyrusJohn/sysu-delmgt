FROM node:24-slim

# Set working directory to /app
WORKDIR /app

# Copy package files from the backend folder
COPY backend/package.json backend/package-lock.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy only runtime source from the root Docker build context
COPY --chown=node:node backend/ ./

ENV NODE_ENV=production \
    PORT=8080

# The host maps its chosen port to this container port; PORT can override it.
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
USER node

# Run the server (files from backend/ copied directly to /app)
CMD ["node", "server.js"]
