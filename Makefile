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

all: submodules models frontend gateway backend