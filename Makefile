SHELL = /bin/bash
.SHELLFLAGS = -o pipefail -c

.PHONY: help
help: ## Print info about all commands
	@echo "Helper Commands:"
	@echo
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "    \033[01;32m%-20s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "NOTE: dependencies between commands are not automatic. Eg, you must run 'deps' and 'build' first, and after any changes"

.PHONY: build
build: ## Compile all modules
	pnpm run build

.PHONY: test
test: ## Run all tests
	pnpm run test

.PHONY: fmt
fmt: ## Run syntax re-formatting
	pnpm run prettier

.PHONY: lint
lint: ## Run style checks and verify syntax
	pnpm run verify

.PHONY: nvm-setup
nvm-setup: ## Use NVM to install and activate node+pnpm
	nvm install 24
	nvm use 24
	corepack enable
	corepack prepare pnpm@11.11.0 --activate

.PHONY: deps
deps: ## Installs dependent libs using 'pnpm install'
	pnpm install --frozen-lockfile

.PHONY: run-dev-plc
run-dev-plc: ## Run PLC server "dev" config (needs local PostgreSQL)
	if [ ! -f "packages/server/.dev.env" ]; then cp packages/server/example.dev.env packages/server/.dev.env; fi
	cd packages/server; ENV=dev pnpm run start | pnpm exec pino-pretty

.PHONY: run-dev-plc-with-db
run-dev-plc-with-db: ## Run PLC server "dev" config, with ephemeral postgres
	if [ ! -f "packages/server/.dev.env" ]; then cp packages/server/example.dev.env packages/server/.dev.env; fi
	cd packages/server; ENV=dev ./pg/with-test-db.sh pnpm run start | pnpm exec pino-pretty
