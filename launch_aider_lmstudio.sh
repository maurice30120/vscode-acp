#!/bin/bash
set -euo pipefail
export OPENAI_API_BASE=http://localhost:1234/v1
export OPENAI_API_KEY=sk-lm-6Rlpc4kO:ENnZt7ae4c3sgv3DPbR3
aider --model openai/devstral-small-2-2512


// /!\ en attente du support ACP 


# # --- CONFIGURATION STRICTE LM STUDIO ---
# # On utilise les variables officielles du SDK Anthropic avec /v1
# export ANTHROPIC_BASE_URL="http://localhost:1234/v1/chat"

# # Compat: certains clients lisent ANTHROPIC_API_KEY, d'autres ANTHROPIC_AUTH_TOKEN.
# # export ANTHROPIC_AUTH_TOKEN="sk-lm-8bfod4ds:8bm9ybGWI1RzII8pyBBb"
# export ANTHROPIC_AUTH_TOKEN=""
# # Ton modèle
# MODEL_NAME="mistralai/devstral-small-2-2512"

# --- VÉRIFICATION DU SERVEUR ---
echo "⏳ Vérification de LM Studio sur le port 1234..."
if ! curl -s "http://localhost:1234/v1/models" > /dev/null; then
    echo "❌ Erreur : LM Studio ne répond pas."
    echo "Assurez-vous que le 'Local Server' est démarré sur le port 1234."
    exit 1
fi

# --- LANCEMENT ---
echo "--------------------------------------------------------"
echo "🚀 Lancement de Claude Code via LM Studio"
echo "🤖 Modèle : $MODEL_NAME"
echo "⚠️  N'oubliez pas de régler le Context Length sur au moins 25k dans LM Studio !"
echo "--------------------------------------------------------"

# Mode debug rapide: ./launch_claude_lmstudio.sh --smoke
if [[ "${1:-}" == "--smoke" ]]; then
    echo "🧪 Test non-interactif Claude -> LM Studio..."
    claude -p --model "$MODEL_NAME" "Respond only with: OK"
    exit 0
fi

# # Lancement interactif
# claude --model "$MODEL_NAME"
aider --model mistralai/devstral-small-2-2512