# 05 — Verrouiller les tests de non-régression

**What to build:** les comportements visibles et les contraintes de confidentialité sont couverts par les tests afin qu'une future modification ne réintroduise pas de persistance ou de fuite de contenu de réflexion.

**Blocked by:** 04 — Rendre la ligne d'activité compacte dans la timeline pipeline.

**Status:** resolved

- [x] Les tests valident qu'une réflexion non-planner crée un signal local minimal.
- [x] Les tests valident que le texte de réflexion n'est pas exposé dans l'activité.
- [x] Les tests valident que la première sortie non-planner efface l'activité.
- [x] Les tests valident que l'activité n'est pas restaurée depuis l'état persisté.
- [x] Les tests valident que le comportement planner existant reste inchangé.

## Comments

Couverture ajoutée dans `HostMessageRouter.test.ts` et `WebviewAppState.test.ts`; suite complète `npm test` validée.
