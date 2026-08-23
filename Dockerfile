FROM ghcr.io/puppeteer/puppeteer:latest

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# Create data directory
RUN mkdir -p data

# Expose port
EXPOSE 3003

# Start the server
CMD ["node", "server.js"]