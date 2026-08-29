$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
if ((Split-Path -Leaf $PSScriptRoot) -eq '.local-update-lab') {
  $projectRoot = Split-Path -Parent $PSScriptRoot
}

Set-Location -LiteralPath $projectRoot
node scripts/local-update-lab.mjs serve
