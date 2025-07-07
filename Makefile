install:
	yarn install

backend: common
	yarn backend build
models:
	yarn models build
frontend:
	yarn frontend build
gateway: install
	yarn gateway build

init-submodules:
	# Ignore errors if submodules are already initialized
	git submodule init
	git submodule sync
	git submodule update --remote

submodules:
	# Ignore errors if submodules are already initialized
	yarn auto-files-gateway install
	yarn auto-files-gateway build

common: install submodules models

test: install
	yarn backend test
	yarn auth test

lint: install
	yarn backend lint
	yarn auth lint
	yarn frontend lint

all: submodules models frontend gateway backend