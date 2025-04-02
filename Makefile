backend:
	yarn backend build
models:
	yarn models build
frontend:
	yarn frontend build
gateway:
	yarn gateway build

submodules:
	git submodules update --init --recursive
	yarn auto-files-gateway install
	yarn auto-files-gateway build

common: submodules models

test:
	yarn backend test
	yarn auth test

lint:
	yarn backend lint
	yarn auth lint
	yarn frontend lint

all: submodules models frontend gateway backend