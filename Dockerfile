# Multi-stage build for TypeScript XMTP Agent
FROM node:22-slim AS builder

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package.json yarn.lock ./

# Install dependencies (including dev dependencies for building)
RUN yarn install --frozen-lockfile

# Copy source code and configuration files
COPY src/ ./src/
COPY tsconfig.json ./

# Build the TypeScript project
RUN yarn build

# Production stage
FROM node:22-slim AS production

# Install dumb-init and CA certificates for proper signal handling and SSL
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd --gid 1001 --system nodejs && \
    useradd --uid 1001 --system --gid nodejs --shell /bin/bash --create-home agent

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install only production dependencies
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory for XMTP database and ensure proper ownership
RUN mkdir -p .data/xmtp && \
    chown -R agent:nodejs .data

# Change to non-root user
USER agent

# Declare volume for database persistence
VOLUME ["/app/.data"]

# Expose port (if your agent serves HTTP endpoints)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "process.exit(0)" || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"] 