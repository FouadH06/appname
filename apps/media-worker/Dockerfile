# ExternalImageProcessor (M10 benchmark decision): transform-only worker. Debian's libheif ships the
# libde265 HEVC decoder, so iPhone HEIC works through heif-dec/heif-convert. Runtime deps are only
# sharp + blurhash, so the image builds standalone (docker build apps/media-worker).
FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends libheif-examples ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm install --omit=dev --no-package-lock --no-save sharp@0.35.5 blurhash@2.0.5 \
 && echo '{"type":"module"}' > package.json
COPY src ./src
USER node
ENV PORT=8790 NODE_ENV=production
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "src/main.ts"]
