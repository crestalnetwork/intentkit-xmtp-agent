# Multi-stage build for TypeScript XMTP Agent
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files for dependency installation
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code and configuration files
COPY src/ ./src/
COPY tsconfig.json ./

# Build the TypeScript project
RUN yarn build

# Production stage
FROM node:22-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S agent -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock ./

# Install only production dependencies
RUN yarn install --frozen-lockfile --production && \
    yarn cache clean

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory for XMTP database
RUN mkdir -p .data/xmtp && \
    chown -R agent:nodejs .data

# Change to non-root user
USER agent

# Expose port (if your agent serves HTTP endpoints)
EXPOSE 3000

# Health check (optional - adjust based on your agent's capabilities)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "console.log('Agent is running')" || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"] 