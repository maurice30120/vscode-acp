FROM node:22-bookworm AS node-runtime

FROM python:3.12-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    VIBE_VENV=/opt/mistral-vibe \
    PATH=/opt/mistral-vibe/bin:${PATH}

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources; \
    fi \
 && if [ -f /etc/apt/sources.list ]; then \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list; \
    fi \
 && apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    bash \
    ca-certificates \
    curl \
    dnsutils \
    git-lfs \
    gnupg \
    iproute2 \
    jq \
    less \
    net-tools \
    nano \
    procps \
    psmisc \
    git \
    openssh-client \
    ripgrep \
    rsync \
    sudo \
    unzip \
    vim \
    wget \
    zip \
    tini \
 && rm -rf /var/lib/apt/lists/*

RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack

# Install the CLIs used by the ACP extension runtime for the default agents:
# - GitHub Copilot: @github/copilot-language-server
# - Claude Code ACP bridge: @zed-industries/claude-code-acp
# - Gemini CLI: @google/gemini-cli
# - Codex: interactive OpenAI Codex CLI
# - Codex ACP bridge: @zed-industries/codex-acp
# - OpenCode: opencode-ai
# - Pi and its ACP adapter: @mariozechner/pi-coding-agent + pi-acp
# - Mistral Vibe ACP entrypoint is installed from Python below
RUN npm install -g \
    @github/copilot-language-server@latest \
    @zed-industries/claude-code-acp@latest \
    @google/gemini-cli@latest \
    @openai/codex \
    @zed-industries/codex-acp@latest \
    opencode-ai@latest \
    @mariozechner/pi-coding-agent \
    pi-acp \
 && python -m venv "${VIBE_VENV}" \
 && "${VIBE_VENV}/bin/pip" install --no-cache-dir --upgrade pip \
 && "${VIBE_VENV}/bin/pip" install --no-cache-dir mistral-vibe \
 && ln -sf "${VIBE_VENV}/bin/vibe" /usr/local/bin/vibe \
 && ln -sf "${VIBE_VENV}/bin/vibe-acp" /usr/local/bin/vibe-acp

WORKDIR /workspace

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
