// sign-release signs a checksums.txt file with the Ed25519 key supplied in
// ARUTOSIO_SIGNING_KEY (base64 seed or private key). Used by the release
// workflow; the public half is embedded in the daemon.
package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"strings"
)

func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: sign-release CHECKSUMS_FILE")
	}
	raw := strings.TrimSpace(os.Getenv("ARUTOSIO_SIGNING_KEY"))
	if raw == "" {
		log.Fatal("ARUTOSIO_SIGNING_KEY is empty")
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		log.Fatalf("ARUTOSIO_SIGNING_KEY: %v", err)
	}
	var priv ed25519.PrivateKey
	switch len(key) {
	case ed25519.SeedSize:
		priv = ed25519.NewKeyFromSeed(key)
	case ed25519.PrivateKeySize:
		priv = ed25519.PrivateKey(key)
	default:
		log.Fatalf("signing key must be a %d-byte seed or %d-byte private key", ed25519.SeedSize, ed25519.PrivateKeySize)
	}

	path := os.Args[1]
	data, err := os.ReadFile(path)
	if err != nil {
		log.Fatal(err)
	}
	sig := ed25519.Sign(priv, data)
	if err := os.WriteFile(path+".sig", []byte(base64.StdEncoding.EncodeToString(sig)+"\n"), 0o644); err != nil {
		log.Fatal(err)
	}
	fmt.Println("signed", path)
}
