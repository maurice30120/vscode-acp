---
ready-for-agent: true
title: "Intégration des skills mattpocock/skills dans l'agent plugin-pi"
---

## Problem Statement

Le dépôt `mattpocock/skills` est **déjà vendored** dans `.agents/skills/` (21 skills, via `npx skills@latest add mattpocock/skills`, tracés dans `skills-lock.json`). Pourtant, **aucun skill n'est réellement exposé à l'agent** aujourd'hui :

1. `plugin-pi` n'utilise PAS le chargement natif de pi pour injecter des skills dans le prompt système. Il a son propre mécanisme (`src/catalog/skillCatalog.ts` → `renderSkillsCatalog`) qui construit un bloc `<available_skills>` **uniquement** à partir de la liste `skills: [...]` déclarée sur la primitive de pipeline courante.
2. Le seul pipeline existant « plan-execute-verify » ne déclare **aucun** `skills:` sur ses primitives (`planner`, `implementer`, `verifier`). `renderSkillsCatalog` retourne donc une chaîne vide et aucun skill n'est injecté.
3. Sur les 21 skills vendored, **13 portent `disable-model-invocation: true`** (ask-matt, grill-me, grill-with-docs, handoff, implement, improve-codebase-architecture, setup-matt-pocock-skills, teach, to-spec, to-tickets, triage, wayfinder, writing-great-skills). `renderSkillsCatalog` les filtre **systematically**,AllowList ou non — ils sont donc ininjectables sans modification du fichier.
4. Le plugin n'offre **aucune** surface de commande `/skill:name` (confirmé : README + code ne mentionnent que l'injection par primitive). Les skills « user-invoked » de mattpocock n'ont donc aucun chemin d'accès dans le runner éphémère.

Pour l'utilisateur, le problème est : *« j'ai installé les skills mattpocock mais mon agent Pi n'en utilise aucun ; je ne sais pas comment les brancher sans toucher au code du plugin. »*

Contrainte explicite : **ne pas modifier le code du plugin**. L'intégration se fait donc uniquement par (a) édition de frontmatter des copies vendored, (b) câblage de `skills:` dans les YAML de pipeline, (c) documentation (ADR). Le runtime `skillCatalog.ts`/`ephemeralRunner.ts` n'est pas touché — tout est configuration/contenu.

## Solution

Activer les skills en trois leviers de configuration, sans toucher au code :

1. **Démultiplexage du drapeau `disable-model-invocation`** : `renderSkillsCatalog` est le seul filtre runtime ; il exclut systématiquement les skills portant le drapeau. On **supprime** ce drapeau sur les 10 skills que l'on veut auto-injectables (grill-me, grill-with-docs, ask-matt, implement, to-spec, to-tickets, triage, wayfinder, improve-codebase-architecture, handoff). Les 3 restants (teach, writing-great-skills, setup-matt-pocock-skills) restent désactivés et **non câblés** : ils sont irrelevant pour les flux d'engineering du plugin ou en conflit avec les conventions existantes (`setup-matt-pocock-skills` écrirait un `CONTEXT.md` déjà présent). L'exposition réelle est alors gouvernée **uniquement** par la liste `skills:` de chaque primitive de pipeline — source de vérité unique.

2. **Câblage `skills:` sur les primitives** : augmenter `plan-execute-verify.yaml` (planner / implementer / verifier) et `async-use-case-review.yaml`, plus ajouter un pipeline dédié `engineering-onboarding.yaml` exposant les skills « router/orchestrateur » (ask-matt, wayfinder, grill-me, grill-with-docs) que l'utilisateur lance intentionnellement.

3. **Documentation & résolution des cross-refs** : les corps de skills référencent `/grilling`, `/grill-me`, `/grill-with-docs`, `/domain-modeling`, `/tdd`. Le runner n'interprète jamais `/skill:name` — on documente la convention de résolution (lire `.agents/skills/<name>/SKILL.md` via `read`) dans un ADR dédié, sans réécrire les corps (pour rester `npx skills update`-friendly). On regénère `skills-lock.json` après édition de frontmatter pour refléter l'état réel du disque.

## Faits établis (non-négociables pour l'exécution)

- `renderSkillsCatalog(catalog, allowList, cwd)` : retourne `""` si `allowList` vide ; filtre `!entry.disableModelInvocation` ; ne lit que `name`/`description`/`disable-model-invocation` du frontmatter (`skillCatalog.ts`).
- Injection déclenchée dans `ephemeralRunner.composeRunnerPrompt` : `if (config.skills === false || !skills || skills.length === 0) return input.promptText;` puis préfixe `${skillsBlock}\n\n${input.promptText}`.
- Aucun agent de `acp-agents.json` (Pi Agent, Codex CLI, OpenCode, Vibe) ne porte `skills: false` → injection globalement enabled.
- Pipeline `plan-execute-verify.yaml` : 3 primitives (planner/implementer/verifier), **zéro** `skills:` déclaré aujourd'hui.
- Pas de `/skill:name` runtime dans le plugin (vérifié README + code).
- Skills déjà pi-tailored : les `description` locales diffèrent des originaux mattpocock (ex. `code-review` décrit l'usage « review since X » façon pi) — frontmatter déjà conforme à pi (≤1024 chars).

## Décisions (décision-complet)

| ID | Décision | Pourquoi |
| ---- | ---------- | ---------- |
| D1 | Supprimer `disable-model-invocation: true` sur 10 skills (grill-me, grill-with-docs, ask-matt, implement, to-spec, to-tickets, triage, wayfinder, improve-codebase-architecture, handoff) | Seul moyen d'injection sans modifier `renderSkillsCatalog` (code interdit). L'allowList reste le gouverneur unique d'exposition. |
| D2 | Laisser `disable-model-invocation: true` sur teach, writing-great-skills, setup-matt-pocock-skills | teach = apprentissage perso hors flux engineering ; writing-great-skills = méta ; setup-matt-pocock-skills = onboarding mattpocock qui écrirait `CONTEXT.md` déjà existant → conflit. |
| D3 | Exposer les skills **uniquement** via `skills:` sur les primitives de pipeline | Mécanisme runtime existant et seul supporté ; pas de surface `/skill:` côté plugin. |
| D4 | Mapping skill → primitive (table ci-dessous) | Alignement: planification/contre-plan (planner), implémentation/TDD/débogage (implementer), revue/qualité (verifier). |
| D5 | Ne pas réécrire les corps `SKILL.md` malgré les `/skill:x` non interprétés | Garder les corps fidèles à l'upstream pour faciliter `npx skills update` ; résoudre `/skill:x` par convention documentée (ADR). |
| D6 | Laisser `argument-hint:` (sur handoff) en place | Champ inconnu ignoré par pi (warning non-bloquant) ; suppression casserait la fidélité upstream. Accepter le warning. |
| D7 | Regénérer `skills-lock.json` (recalcul des `computedHash`) après strip frontmatter | Le lock doit refléter l'état réel du disque ; les hashes divergeront de l'upstream — documenter dans ADR. |
| D8 | Upstream re-sync = manuel + re-strip manuel des 10 skills | `npx skills@latest update mattpocock/skills` restaurera les drapeaux ; pas de script automatisé (code interdit). ADR documente la procédure. |
| D9 | Ne pas exécuter `/setup-matt-pocock-skills` | plugin-pi possède déjà `CONTEXT.md` + `adr/` + `tickets.md` + `ROADMAP.md` ; l'exécuter écraserait ces fichiers. |
| D10 | Garder `ask-matt` et `wayfinder` exposés dans une primitive dédiée `engineering-onboarding.yaml` | Ce sont des routeurs ; les injecter dans une primitive que l'utilisateur lance intentionnellement, jamais en arrière-plan d'une autre étape. |

## D4 — Mapping skill → primitive

### Pipeline `plan-execute-verify.yaml` (augmenté)

| Primitive (agent) | skills injectés |
| ------------------- | ----------------- |
| `planner` (Pi Agent) | grilling, grill-with-docs, grill-me, domain-modeling, codebase-design, to-spec, to-tickets, triage, research, ask-matt, wayfinder, prototype |
| `implementer` (Vibe) | implement, tdd, diagnosing-bugs, codebase-design, handoff |
| `verifier` (OpenCode) | code-review, improve-codebase-architecture, diagnosing-bugs |

### Pipeline `engineering-onboarding.yaml` (nouveau, lancement intentionnel)

| Primitive | agent | skills | objet |
|-----------|-------|--------|-------|
| `route` | Pi Agent | ask-matt, wayfinder | aide l'utilisateur à choisir un skill/flow |
| `grill` | Pi Agent | grill-me, grilling, grill-with-docs, domain-modeling | interview de sharpening avant de bâtir |

### Pipeline `async-use-case-review.yaml` (augmenté)

- Ajouter `skills: [code-review, improve-codebase-architecture]` à sa primitive de revue (se limiter aux skills de revue — avoid injecter des skills de planification dans une passe de revue).

### Skills non câblés (par décision D2)

teach, writing-great-skills, setup-matt-pocock-skills — présents sur disque (fidélité upstream / usage futur) mais jamais injectés.

## User Stories

1. En tant qu'utilisateur de plugin-pi, je veux que mon `planner` connaisse les skills de grilling/planification, de sorte que l'agent propose une interview sharpening et un spec avant d'implémenter.
2. En tant qu'utilisateur, je veux que l'`implementer` connaisse `implement`, `tdd` et `diagnosing-bugs`, de sorte qu'il suive red-green-refactor et boucle de diagnostic sans que je lui rappelle.
3. En tant qu'utilisateur, je veux que le `verifier` utilise `code-review` et `improve-codebase-architecture`, de sorte que la revue suive les deux axes Standards/Spec et détecte les modules peu profonds.
4. En tant qu'utilisateur, je veux un pipeline `engineering-onboarding` que je lance intentionnellement pour être grillé ou pour découvrir quel skill appliquer, de sorte que les routeurs (`ask-matt`, `wayfinder`) ne polluent pas les étapes d'exécution automatique.
5. En tant qu'utilisateur, je veux qu'un skill portant `disable-model-invocation: true` (ex. `grill-me`) devienne réellement injectable, de sorte qu'il ne soit plus silencieusement filtré.
6. En tant qu'utilisateur, je veux que l'exposition réelle d'un skill dépende uniquement de la primitive qui le liste, de sorte qu'il y ait une source de vérité unique (l'allowList) plutôt que deux filtres contradictoires.
7. En tant qu'utilisateur, je veux que les références `/grilling`, `/grill-with-docs`, `/domain-modeling`, `/tdd` dans les corps de skills soient résolvables en chargeant le fichier sibling, de sorte que les skills composables fonctionnent malgré l'absence de runtime `/skill:`.
8. En tant qu'utilisateur, je veux que les skills inutiles au flux engineering (`teach`, `writing-great-skills`, `setup-matt-pocock-skills`) ne soient jamais injectés, de sorte qu'ils n'induisent pas l'agent en erreur.
9. En tant qu'utilisateur, je veux que `setup-matt-pocock-skills` ne soit **pas** exécuté, de sorte que mes fichiers `CONTEXT.md`, `adr/`, `tickets.md`, `ROADMAP.md` existants ne soient pas écrasés.
10. En tant qu'utilisateur, je veux que `skills-lock.json` reste cohérent avec le disque après édition des frontmatters, de sorte qu'un audit de drifted skills détecte les vraies divergences et non les éditions intentionnelles.
11. En tant qu'utilisateur, je veux un ADR documentant l'intégration (décisions D1–D10 + procédure de re-strip à l'upstream sync), de sorte que la motivation survives et qu'un futur contributeur sache pourquoi les drapeaux ont été retirés.
12. En tant qu'utilisateur, je veux qu'une re-sync upstream via `npx skills@latest update` ne réintroduise pas silencieusement les `disable-model-invocation`, de sorte que la procédure de re-strip soit connue (ADR) même si elle reste manuelle.
13. En tant qu'utilisateur, je veux qu'aucun fichier du runtime plugin (`src/**/*.ts`) ne soit modifié, de sorte que l'intégration soit purement configuration/contenu et réversible par `git revert` des YAML + frontmatters.

## Étapes d'implémentation (aucune modification de code runtime)

1. **Strip frontmatter (10 skills).** Pour chacun de : `ask-matt, grill-me, grill-with-docs, handoff, implement, improve-codebase-architecture, to-spec, to-tickets, triage, wayfinder`, supprimer la ligne `disable-model-invocation: true` du `SKILL.md`. Vérifier que `name` et `description` restent intacts.
2. **Augmenter `plan-execute-verify.yaml`.** Ajouter la clé `skills:` aux primitives `planner`, `implementer`, `verifier` selon la table D4. Conserver `agent`, `output`, `sideEffects`, `prompt` inchangés.
3. **Créer `.pi/.acp/pipelines/engineering-onboarding.yaml`.** Deux primitives `route` et `grill` (voir table D4), `sideEffects: none`, `output: markdown`, prompts minimaux invitant l'agent à appliquer les skills listés.
4. **Augmenter `async-use-case-review.yaml`.** Ajouter `skills: [code-review, improve-codebase-architecture]` à sa primitive de revue.
5. **Regénérer `skills-lock.json`.** Recalculer le SHA-256 de chaque `SKILL.md` édité ; mettre à jour `computedHash`. Les hashes des 10 skills strippés divergeront de l'upstream — c'est attendu (D7).
6. **Écrire l'ADR** `adr/0009-integration-mattpocock-skills.md` : constat (zéro skill injecté aujourd'hui), décisions D1–D10, table de mapping, convention de résolution `/skill:x` (lire `.agents/skills/<x>/SKILL.md`), procédure de re-strip à l'upstream sync (D8), note `argument-hint` (D6).
7. *(Optionnel)* Ajouter une entrée au `README.md` (section Skills) exposant le pipeline `engineering-onboarding` et le mapping skill→primitive pour l'utilisateur final.

## Risques & mitigations

| Risque | Mitigation |
| -------- | ----------- |
| Re-sync upstream (`npx skills@latest update`) restaure les `disable-model-invocation: true` → skills re-filtrés silencieusement | ADR D8 documente la procédure manuelle de re-strip ; `skills-lock.json` divergent sert de signal d'audit. |
| `ask-matt`/`wayfinder` injectés dans `planner` pourrait faire router l'agent au lieu de planifier | On les garde dans `planner` (utiles pour guider le plan) mais les routeurs purs vivent dans `engineering-onboarding.route` (lancement intentionnel). |
| Skills composables (`grill-me` qui appelle `/grilling`) ne s'enchaînent pas automatiquement (pas de runtime `/skill:`) | Convention ADR : le corps instruit l'agent de `read .agents/skills/<x>/SKILL.md` ; `grilling` est aussi dans l'allowList de `planner` donc déjà disponible. |
| Sur-injection : trop de skills dans `planner` (12) gonfle le prompt | `renderSkillsCatalog` n'injecte que `name`/`description`/`location` (légèreté ← progressive disclosure) ; acceptable. Réduire à un cœur dur si mesuré. |
| `setup-matt-pocock-skills` exécuté par erreur écrase `CONTEXT.md`/`adr/` | D9: explicitement non câblé + avertissement dans l'ADR. |
| `skills-lock.json` hashes divergent upstream → audit "drift" faussement positif | Documenté dans l'ADR : le drift des 10 skills est **intentionnel**. |

## Vérification (sans code)

1. **Test d'injection** : lancer le pipeline `plan-execute-verify` avec un prompt trivial ; vérifier (via log `composeRunnerPrompt` ou capture du prompt composé) que le bloc `<available_skills>` précède le prompt et contient exactement les skills de la primitive courante, et **aucun** skill `disable-model-invocation`.
2. **Test de filtre** : confirmer que `teach`, `writing-great-skills`, `setup-matt-pocock-skills` n'apparaissent dans **aucun** bloc injecté (D2).
3. **Test de cohérence lock** : recalculer le SHA-256 des 10 `SKILL.md` édités et comparer à `skills-lock.json` → doivent matcher.
4. **Test de pipeline onboarding** : lancer `engineering-onboarding` → vérifier l'injection de `ask-matt`/`wayfinder` (route) et `grill-me`/`grilling`/`grill-with-docs`/`domain-modeling` (grill).
5. **Test de non-régression** : `plan-execute-verify` sans `skills:` (avant modif) injectait `""` ; après modif, injecte le bloc — aucun agent ne porte `skills: false`, donc aucun agent désactivé par erreur.

## Rollback

- `git revert` des commits YAML (`plan-execute-verify.yaml`, `async-use-case-review.yaml`, suppression `engineering-onboarding.yaml`) doit remettre l'injection à zéro (état actuel).
- Restaurer les `disable-model-invocation: true` sur les 10 skills (ou `git revert` des `SKILL.md`) rétablit le filtrage runtime.
- L'ADR peut rester (document historique) ou être retiré.
- Aucunemodification du runtime → aucune régression de compilation/type possible ; `test/configCatalog.test.ts` non impacté (il ne teste pas les frontmatters des skills vendored).
