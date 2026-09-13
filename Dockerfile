FROM node:24-alpine
WORKDIR /app
COPY . .
ENV PORT=8080 HOST=0.0.0.0
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server.mjs"]
