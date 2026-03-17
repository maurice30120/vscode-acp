FROM node:22-bookworm AS node-runtime

FROM python:3.12-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    VIBE_VENV=/opt/mistral-vibe \
    PATH=/opt/mistral-vibe/bin:${PATH}

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN apt-get update && apt-get install -y --no-install-recommends \
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

# Install the CLIs used by the ACP extension runtime:
# - codex: interactive OpenAI Codex CLI
# - codex-acp: ACP bridge used by this repo's default Codex agent config
# - vibe / vibe-acp: Mistral Vibe CLI and ACP entrypoint (requires Python >= 3.12)
RUN npm install -g @openai/codex @zed-industries/codex-acp \
 && python -m venv "${VIBE_VENV}" \
 && "${VIBE_VENV}/bin/pip" install --no-cache-dir --upgrade pip \
 && "${VIBE_VENV}/bin/pip" install --no-cache-dir mistral-vibe \
 && ln -sf "${VIBE_VENV}/bin/vibe" /usr/local/bin/vibe \
 && ln -sf "${VIBE_VENV}/bin/vibe-acp" /usr/local/bin/vibe-acp

WORKDIR /workspace

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
