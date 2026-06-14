.PHONY: install dev verify format format-check lint typecheck test check-docs check-architecture

install:
	pnpm install

dev:
	pnpm dev

verify:
	pnpm verify

format:
	pnpm format

format-check:
	pnpm format:check

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
