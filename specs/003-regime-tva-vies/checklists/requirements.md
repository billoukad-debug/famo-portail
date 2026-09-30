# Specification Quality Checklist: Régime TVA par client et contrôle VIES

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-30
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- La spec nomme des éléments imposés par la loi ou par le format d'échange (catégories UBL K/G/AE,
  API officielle VIES) : ce sont des exigences externes, pas des choix d'implémentation.
- Les mentions légales et les schémas d'adresse Peppol étrangers sont marqués « à valider par le
  comptable » (hypothèses documentées), pas « NEEDS CLARIFICATION » : la fonctionnalité est livrable,
  le texte se corrige à un seul endroit.
- La mention proposée dans la demande (« art. 196 ») a été remplacée par celle des livraisons de
  biens (art. 138 directive / 39bis CTVA) : justification dans « Assumptions ».
