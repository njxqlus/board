FROM oven/bun:1.3.14

WORKDIR /app

COPY package.json bun.lock ./
COPY patches ./patches
RUN bun install --frozen-lockfile

COPY bunfig.toml tsconfig.json build.ts LICENSE ./
COPY src ./src
COPY styles ./styles
COPY migrations ./migrations

RUN bun run build

RUN chown -R bun:bun /app
USER bun

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD bun -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "src/index.ts"]
