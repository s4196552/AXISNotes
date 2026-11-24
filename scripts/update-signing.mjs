// Ed25519 signing for the updates folder's latest.json (T-282). publish-update.ps1 calls it;
// the app checks the signature with the public key embedded in src-tauri/src/updates.rs.
//
//   node scripts/update-signing.mjs keygen <key file>             writes a new private key
//   node scripts/update-signing.mjs pubkey <key file>             prints its public key
//   node scripts/update-signing.mjs sign <key file> <file> <sig>  signs the file's bytes
//   node scripts/update-signing.mjs verify <public key> <file> <sig>
//
// Public keys and signatures are standard base64 of the raw 32-byte key and 64-byte
// signature. The private key is a PKCS#8 PEM file kept outside the repository.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw key is the 32 bytes after it.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const rawPublicKey = (key) => {
  const der = createPublicKey(key).export({ format: "der", type: "spki" });
  return der.subarray(SPKI_PREFIX.length).toString("base64");
};

const publicKeyFromRaw = (b64) => {
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) throw new Error("A public key is 32 bytes of base64.");
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
};

const loadPrivateKey = (path) => {
  const key = createPrivateKey(readFileSync(path));
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`${path} is not an Ed25519 key.`);
  return key;
};

const [command, ...args] = process.argv.slice(2);
const need = (n, usage) => {
  if (args.length !== n) {
    console.error(`usage: node scripts/update-signing.mjs ${command} ${usage}`);
    process.exit(2);
  }
};

try {
  switch (command) {
    case "keygen": {
      need(1, "<key file>");
      const [path] = args;
      if (existsSync(path)) throw new Error(`${path} already exists; it is not replaced.`);
      const { privateKey } = generateKeyPairSync("ed25519");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, privateKey.export({ format: "pem", type: "pkcs8" }), {
        mode: 0o600,
        flag: "wx",
      });
      console.log(rawPublicKey(privateKey));
      break;
    }
    case "pubkey": {
      need(1, "<key file>");
      console.log(rawPublicKey(loadPrivateKey(args[0])));
      break;
    }
    case "sign": {
      need(3, "<key file> <file> <signature file>");
      const [keyPath, file, sigPath] = args;
      const signature = sign(null, readFileSync(file), loadPrivateKey(keyPath));
      writeFileSync(sigPath, `${signature.toString("base64")}\n`);
      break;
    }
    case "verify": {
      need(3, "<public key> <file> <signature file>");
      const [pub, file, sigPath] = args;
      const signature = Buffer.from(readFileSync(sigPath, "utf8").trim(), "base64");
      if (!verify(null, readFileSync(file), publicKeyFromRaw(pub), signature)) {
        throw new Error(`The signature in ${sigPath} does not match ${file}.`);
      }
      console.log("signature ok");
      break;
    }
    default:
      console.error("usage: node scripts/update-signing.mjs keygen|pubkey|sign|verify …");
      process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
