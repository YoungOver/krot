.PHONY: dev web server test
dev:            ## API, edge and agent listener on :8081, :8080, :7000
	cd server && go run ./cmd/krotd
web:            ## dashboard with the in-browser demo API
	cd web && npm run dev
test:
	cd server && go test -race -count=1 ./...
	cd web && npx tsc -b && npm run build
