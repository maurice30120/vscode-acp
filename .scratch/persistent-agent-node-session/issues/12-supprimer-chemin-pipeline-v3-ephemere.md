# 12 — Supprimer le chemin Pipeline V3 à relances éphémères

**What to build:** La Migration complète de connexion agent est effective pour Pipeline V3 sans feature flag durable ni double sémantique, tout en conservant les usages non pipeline qui restent explicitement éphémères.

**Blocked by:** 11 — Ajouter la suite de contrat de Parité hôte.

**Status:** ready-for-agent

- [ ] Le chemin Pipeline V3 basé sur les relances éphémères n'est plus utilisé par le Runtime partagé ni par les Surfaces hôtes.
- [ ] Les usages non pipeline encore éphémères, dont VS Code InlineEdit, restent disponibles sans acquérir de sémantique d'Entretien agent.
- [ ] Les messages d'erreur et diagnostics ne suggèrent pas de fallback pipeline éphémère.
- [ ] La suite de tests existante et la suite de contrat confirment qu'une seule sémantique Pipeline V3 reste maintenue.
