# keelroom, built and then stripped back to what it needs to run.
FROM node:20.18.1-bookworm-slim AS build

WORKDIR /app

# better-sqlite3 is a native addon, so the build stage needs a compiler even
# though the runtime stage does not
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# drop everything that was only needed to build
RUN npm prune --omit=dev

FROM node:20.18.1-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json README.md ./

# the district file lives outside the image
VOLUME ["/data"]
ENV KEELROOM_DATABASE=/data/district.sqlite

USER node

ENTRYPOINT ["node", "dist/cli/main.js"]
CMD ["--help"]
