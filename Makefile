
.PHONY: build all test lint frontend backend auth gateway models dtos packages

all: packages
	yarn build

packages:
	yarn packages build

backend: packages
	yarn backend build

frontend: packages
	yarn frontend build

auth: packages
	yarn auth build

gateway: packages
	yarn gateway build

	