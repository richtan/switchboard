FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3402
CMD ["./node_modules/.bin/tsx", "src/index.ts", "--no-tui"]
