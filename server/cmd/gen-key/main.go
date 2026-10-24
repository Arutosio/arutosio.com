// gen-key creates the Ed25519 keypair used to sign release bundles. The seed
// is written outside the repository; the public key goes into sign.go (or is
// passed to the daemon with -update-pubkey).
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log"
	"os"
)

func main() {
	if len(os.Args) != 2 {
		log.Fatal("usage: gen-key PRIVATE_KEY_FILE")
	}
	path := os.Args[1]
	if _, err := os.Stat(path); err == nil {
		log.Fatalf("%s already exists; refusing to overwrite a signing key", path)
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		log.Fatal(err)
	}
	seed := []byte(base64.StdEncoding.EncodeToString(priv.Seed()) + "\n")
	if err := os.WriteFile(path, seed, 0o600); err != nil {
		log.Fatal(err)
	}
	fmt.Println("private key:", path)
	fmt.Println("public key: ", hex.EncodeToString(pub))
	fmt.Println("Set it as a repository secret:")
	fmt.Printf("  gh secret set ARUTOSIO_SIGNING_KEY < %s\n", path)
}
