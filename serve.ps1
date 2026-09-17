$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
  Write-Error 'Faltan las dependencias. Ejecuta "corepack pnpm install" una vez antes de iniciar el juego.'
  exit 1
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if ($null -eq $nodeExe) {
  foreach ($candidate in @("$env:ProgramFiles\nodejs\node.exe", "${env:ProgramFiles(x86)}\nodejs\node.exe")) {
    if (Test-Path -LiteralPath $candidate) { $nodeExe = $candidate; break }
  }
}
if ($null -eq $nodeExe) {
  Write-Error 'No se encontró Node.js. Instala Node.js 20 o posterior y vuelve a intentarlo.'
  exit 1
}

& $nodeExe (Join-Path $projectRoot 'node_modules/vite/bin/vite.js') --host 127.0.0.1 --port 8080
exit $LASTEXITCODE
