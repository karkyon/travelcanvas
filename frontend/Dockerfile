FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Build application
RUN npm run build

# Expose port
EXPOSE 3000

# Run application (for production use nginx instead)
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0"]
