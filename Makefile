.PHONY: dev-up dev-down dev-server dev-web test

dev-up:
	docker compose -f docker-compose.oss.yml up -d
	@echo "waiting for Firestore emulator on :8080…"
	@for i in $$(seq 1 30); do curl -sf http://localhost:8080/ >/dev/null 2>&1 && { echo "firestore ready"; break; }; sleep 1; done

dev-down:
	docker compose -f docker-compose.oss.yml down

dev-server:
	pnpm --filter @intellilabs/server dev

dev-web:
	pnpm --filter @intellilabs/web dev

test:
	pnpm -r --if-present test
