FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app.js db.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000

USER node

EXPOSE 3000

CMD ["node", "app.js"]