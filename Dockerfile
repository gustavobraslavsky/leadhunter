FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root for installation
USER root

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# Create data directory and set permissions
RUN mkdir -p data && chown -R pptruser:pptruser /app

# Switch back to pptruser for running
USER pptruser

# Expose port
EXPOSE 3003

# Start the server
CMD ["node", "server.js"]