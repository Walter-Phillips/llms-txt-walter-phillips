.PHONY: install dev verify lint typecheck test check-docs check-architecture

install:
	pnpm install

dev:
	pnpm dev

verify:
	pnpm verify

lint:
	pnpm lint

typecheck:
	pnpm typecheck

test:
	pnpm test

check-docs:
	pnpm check-docs

check-architecture:
	pnpm check-architecture
