# Obraz produkcyjny dziennika tradingowego.
# Trzy etapy: zaleznosci, build, obraz wykonawczy ze standalone.
# Baza glibc (nie alpine), bo `sharp` ma dla niej gotowe binaria - kompilacja
# libvips w obrazie to kilka minut i kolejny punkt awarii.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build nie potrzebuje zadnych sekretow ani bazy: polaczenie powstaje
# przy pierwszym zapytaniu, a strony aplikacji sa dynamiczne.
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV UPLOADS_DIR=/data/zrzuty

RUN groupadd --system --gid 1001 dziennik \
  && useradd --system --uid 1001 --gid dziennik dziennik \
  && mkdir -p /data/zrzuty \
  && chown -R dziennik:dziennik /data

COPY --from=builder --chown=dziennik:dziennik /app/public ./public
COPY --from=builder --chown=dziennik:dziennik /app/.next/standalone ./
COPY --from=builder --chown=dziennik:dziennik /app/.next/static ./.next/static
# Migracje i ich pliki SQL musza trafic do obrazu osobno - `standalone`
# sledzi tylko to, co importuje aplikacja.
COPY --from=builder --chown=dziennik:dziennik /app/drizzle ./drizzle
COPY --from=builder --chown=dziennik:dziennik /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=dziennik:dziennik /app/docker-start.sh ./docker-start.sh

USER dziennik
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./docker-start.sh"]
