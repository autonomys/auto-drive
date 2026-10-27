install:
	yarn install

backend: common submodules
	yarn backend build
models:
	yarn models build
s3:
	yarn s3 build
frontend:
	yarn frontend build
ui: install
	yarn workspace @auto-drive/ui build

init-submodules:
	# Ignore errors if submodules are already initialized
	git submodule init
	git submodule sync
	git submodule update --remote

submodules:
	# Ignore errors if submodules are already initialized
	yarn auto-files-gateway install
	yarn auto-files-gateway build

common: install submodules models s3 ui

# The frontend suite is here deliberately. It was absent, so every frontend spec
# in the repo — including the ones covering the USDC purchase state machine —
# passed or failed without gating a merge. It needs no Docker and runs in
# seconds, unlike the backend's TestContainers suites.
test: install common
	yarn backend test
	yarn auth test
	yarn frontend test

lint: install
	yarn backend lint
	yarn auth lint
	yarn frontend lint

all: submodules models ui s3 frontend backend