# Agent Guide

This repository is designed for agent-first engineering. Keep this file short:
it is the map, not the manual.

X## Start Here

- Product context: `docs/PRODUCT.md`
- Architecture map: `ARCHITECTURE.md`
- Design standards: `docs/DESIGN.md`
- Quality bar: `docs/QUALITY.md`
- Reliability bar: `docs/RELIABILITY.md`
- Security bar: `docs/SECURITY.md`
- Long-running plans: `docs/exec-plans/`

## Working Loop

1. Read the smallest relevant source of truth before editing.
2. Make scoped changes that preserve the documented architecture.
3. Run `make verify` before opening or updating a pull request.
4. When behavior changes, update the docs that future agents will read.
5. If a repeated review comment appears, encode it in docs, tests, or linting.

## Repository Rules

- Prefer typed boundaries and parsed external data.
- Keep domain logic out of UI components when a service or package boundary exists.
- Add tests for behavior, not implementation trivia.
- Do not leave generated dead ends: remove stale docs, unused helpers, and obsolete plans.
- Keep pull requests small enough that another agent can review them mechanically.
