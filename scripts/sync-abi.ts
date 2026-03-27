/**
 * sync-abi.ts
 * Copia el ABI de RemiWallet.sol compilado al directorio abi/.
 * Se ejecuta automáticamente después de `npm run compile` (postcompile).
 */
import * as fs from 'fs';
import * as path from 'path';

const artifactPath = path.resolve(
  __dirname,
  '../artifacts/contracts/RemiWallet.sol/RemiWallet.json',
);
const destPath = path.resolve(
  __dirname,
  '../abi/RemiWallet.abi.json',
);

if (!fs.existsSync(artifactPath)) {
  console.error('sync-abi: artifact not found — run `npm run compile` first');
  process.exit(1);
}

const abiDir = path.dirname(destPath);
if (!fs.existsSync(abiDir)) {
  fs.mkdirSync(abiDir, { recursive: true });
}

const { abi } = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
fs.writeFileSync(destPath, JSON.stringify(abi, null, 2) + '\n');
console.log(`sync-abi: ABI synced → ${path.relative(process.cwd(), destPath)}`);
