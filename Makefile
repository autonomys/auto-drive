SUBMODULES_VERSION := v1.0.2

install:
	yarn install

backend: common
	yarn backend build
models:
	yarn models build
frontend:
	yarn frontend build
gateway:
	yarn gateway build

submodules:
	git submodule update --init --recursive
	git submodule foreach git checkout $(SUBMODULES_VERSION)
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