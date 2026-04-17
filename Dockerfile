# =================================================================
# Stage 1: Build — install deps, compile rust, esbuild bundle
# =================================================================
FROM node:22-alpine AS build

WORKDIR /usr/src/app

# System dependencies for native modules + Rust + Python
RUN apk add --no-cache \
  python3 py3-pip python3-dev \
  build-base gfortran musl-dev linux-headers \
  lapack-dev openblas-dev \
  jpeg-dev zlib-dev freetype-dev \
  libffi-dev openssl-dev \
  rust cargo \
  git

# Skip puppeteer chromium download during npm install
ARG PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=${PUPPETEER_SKIP_DOWNLOAD}

# Install Node.js dependencies
COPY package*.json ./
RUN npm ci

# Build rust-vexus-lite native module
COPY rust-vexus-lite/ ./rust-vexus-lite/
RUN cd rust-vexus-lite && npm install && npm run build

# Install Python dependencies
COPY python/requirements.txt ./python/
RUN sed -i '/^win10toast/s/^/#/' python/requirements.txt && \
    python3 -m pip install --no-cache-dir --break-system-packages -U pip setuptools wheel && \
    pip3 install --no-cache-dir --break-system-packages --target=/usr/src/app/pydeps -r python/requirements.txt

# Copy all source code
COPY . .

# Install plugin Python/Node dependencies
RUN find Plugin -name requirements.txt -exec sh -c ' \
    for req_file do \
        echo ">>> Installing Python deps from $req_file"; \
        pip3 install --no-cache-dir --break-system-packages --target=/usr/src/app/pydeps -r "$req_file" || \
            echo "!!! Warning: failed to install $req_file"; \
    done' sh {} + 2>/dev/null || true

RUN find Plugin -name package.json -not -path "*/node_modules/*" -exec sh -c ' \
    for pkg_file do \
        plugin_dir=$(dirname "$pkg_file"); \
        echo ">>> Installing Node.js deps in $plugin_dir"; \
        (cd "$plugin_dir" && npm install --legacy-peer-deps 2>/dev/null) || \
            echo "!!! Warning: failed to install in $plugin_dir"; \
    done' sh {} + 2>/dev/null || true

# esbuild bundle: server + admin → single file
RUN npm run bundle

# =================================================================
# Stage 2: Production — minimal runtime
# =================================================================
FROM node:22-alpine

WORKDIR /usr/src/app

# Runtime system dependencies
RUN apk add --no-cache \
  chromium nss freetype harfbuzz ttf-freefont \
  tzdata python3 openblas \
  jpeg-dev zlib-dev freetype-dev libffi \
  ffmpeg

ENV PYTHONPATH=/usr/src/app/pydeps
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# --- Copy esbuild bundle ---
COPY --from=build /usr/src/app/dist/vcp.bundle.js ./vcp.bundle.js

# --- Copy full node_modules (plugins need runtime module resolution) ---
COPY --from=build /usr/src/app/node_modules ./node_modules

# rust-vexus-lite (full directory — includes compiled .node + JS loader)
COPY --from=build /usr/src/app/rust-vexus-lite ./rust-vexus-lite

# --- Copy Python dependencies ---
COPY --from=build /usr/src/app/pydeps ./pydeps

# --- Copy application resources ---
# ⚠️ AdminPanel 解耦到独立仓库（VCPtoolbox-Junior-Panel）后，本体 repo 根目录
# 不含 AdminPanel/；CI 构建时由 release.yml 的 docker job 先 clone + build panel，
# 再 cp panel/dist → main/AdminPanel 后才进入 docker build context。
# 本地手工 docker build 前请执行：
#   git clone https://github.com/FuHesummer/VCPtoolbox-Junior-Panel.git ../panel
#   (cd ../panel && npm ci && npm run build)
#   cp -r ../panel/dist ./AdminPanel
COPY --from=build /usr/src/app/AdminPanel ./AdminPanel
COPY --from=build /usr/src/app/Agent ./Agent
COPY --from=build /usr/src/app/Plugin ./Plugin
COPY --from=build /usr/src/app/TVStxt ./TVStxt
COPY --from=build /usr/src/app/thinking ./thinking
COPY --from=build /usr/src/app/modules ./modules
COPY --from=build /usr/src/app/routes ./routes
COPY --from=build /usr/src/app/knowledge ./knowledge
COPY --from=build /usr/src/app/scripts ./scripts
COPY --from=build /usr/src/app/image ./image
COPY --from=build /usr/src/app/docs ./docs

# Copy standalone files
COPY --from=build /usr/src/app/config.env.example ./
COPY --from=build /usr/src/app/maintain.js ./
COPY --from=build /usr/src/app/package.json ./
COPY --from=build /usr/src/app/python/requirements.txt ./python/
COPY --from=build /usr/src/app/agent_map.json ./

# Copy Python scripts in root (if any)
COPY --from=build /usr/src/app/*.py ./

# --- Persistence config & sync scripts ---
COPY docker-persist.json ./
COPY docker-entrypoint.sh /usr/local/bin/
COPY build/docker-sync.js ./build/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# --- Save image defaults for entrypoint sync ---
# On container update, entrypoint merges these into the data/ volume:
#   plugin  → version-based smart upgrade, preserve user state
#   merge   → add new files, never overwrite existing
RUN mkdir -p /opt/defaults && \
    cp -r Plugin   /opt/defaults/Plugin   && \
    cp -r Agent    /opt/defaults/Agent    && \
    cp -r TVStxt   /opt/defaults/TVStxt   && \
    cp -r thinking /opt/defaults/thinking && \
    cp -r knowledge /opt/defaults/knowledge && \
    cp agent_map.json /opt/defaults/agent_map.json 2>/dev/null || true

# Create runtime directories (used when running without data/ volume)
RUN mkdir -p knowledge thinking VCPTimedContacts dailynote \
             VCPAsyncResults DebugLog VectorStore \
             Plugin/VCPLog/log Plugin/EmojiListGenerator/generated_lists

# Main server port + Admin panel port
EXPOSE 6005 6006

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "vcp.bundle.js"]
