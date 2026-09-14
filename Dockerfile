# ---- build stage ----------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install with dev dependencies so we can compile, then throw them away.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage --------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# Containers have no TTY, so structured JSON logs beat the pretty printer.
ENV LOG_PRETTY=false
# The dashboard must listen on all interfaces to be reachable from outside the
# container. Publish it to 127.0.0.1 on the host (see docs/DEPLOYMENT.md) or
# set DASHBOARD_TOKEN — config.ts refuses to start without one otherwise.
ENV DASHBOARD_HOST=0.0.0.0
ENV DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Never run a process holding a funded key as root.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 4311

# No shell wrapper, so SIGTERM reaches Node directly and the bot's own
# shutdown handler runs instead of the container being killed.
ENTRYPOINT ["node", "dist/index.js"]
CMD ["run"]
