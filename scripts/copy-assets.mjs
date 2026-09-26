// Copia los modelos 3D a dist/ (Vite solo empaqueta lo que se importa; los .glb se cargan por ruta en runtime).
// Con --zip además genera worldbox3d-hostinger.zip listo para subir a Hostinger.
import { cp, writeFile, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await stat(dist).catch(() => { throw new Error('No existe dist/. Ejecuta primero "vite build".'); });

await cp(path.join(root, 'assets'), path.join(dist, 'assets'), {
  recursive: true,
  // "source*" son copias de trabajo que el juego no usa.
  filter: src => !/^source( \(\d+\))?$/.test(path.relative(path.join(root, 'assets'), src).split(path.sep)[0]),
});

const htaccess = `# Apache (Hostinger)
AddType model/gltf-binary .glb
AddType application/javascript .js .mjs
AddType application/json .json .map
<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json model/gltf-binary
</IfModule>
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType model/gltf-binary "access plus 1 month"
  ExpiresByType image/jpeg "access plus 1 month"
  ExpiresByType text/css "access plus 1 week"
  ExpiresByType application/javascript "access plus 1 week"
</IfModule>
`;
await writeFile(path.join(dist, '.htaccess'), htaccess);
console.log('Assets copiados a dist/');

if (process.argv.includes('--zip')) {
  const zip = path.join(root, 'worldbox3d-hostinger.zip');
  await rm(zip, { force: true });
  // En Windows, el tar de System32 (bsdtar) sabe crear zip; el de Git Bash no.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  let r = spawnSync(tar, ['-a', '-c', '-f', zip, '-C', dist, '.'], { stdio: 'inherit' });
  if (r.status !== 0 || !(await stat(zip).catch(() => null))?.size) {
    r = spawnSync('zip', ['-r', '-q', zip, '.'], { cwd: dist, stdio: 'inherit' });
  }
  if (r.status !== 0) throw new Error('No se pudo crear el zip (necesitas "tar" con soporte zip o el comando "zip").');
  console.log('Listo: worldbox3d-hostinger.zip');
}
