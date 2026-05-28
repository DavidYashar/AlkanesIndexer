param(
    [Parameter(Mandatory = $true)]
    [string]$Passphrase,

    [string]$WalletFile = (Join-Path $HOME ".alkanes\wallet.json"),
    [string]$JsonRpcUrl = "https://signet.subfrost.io/v4/jsonrpc",
    [string]$EsploraApiUrl = "https://mempool.space/signet/api",
    [string]$AlkanesRpcUrl = "https://signet.subfrost.io/v4/subfrost",
    [string]$FromAddress = "p2wpkh:0",
    [string]$ChangeAddress = "p2wpkh:0",
    [string]$ToAddress = "p2tr:0",
    [UInt64]$FeeRate = 2,
    [UInt64]$EngineTokenTx = 61002,
    [UInt64]$ClaimManagerTx = 61003,
    [UInt64]$TokenCap = 21000000,
    [UInt64]$PremineUnits = 0,
    [UInt64]$SettlementAuthUnits = 21000,
    [string]$TokenName = "Engine",
    [string]$TokenSymbol = "ENGINE",
    [string]$OutputPath = "scripts\engine-miner-signet-deployment.json"
)

$ErrorActionPreference = "Stop"

function Write-Info([string]$Message) {
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Success([string]$Message) {
    Write-Host "[OK]   $Message" -ForegroundColor Green
}

function Get-RepoRoot {
    return Split-Path -Parent $PSScriptRoot
}

function Get-CellpackStringWords([string]$Value) {
    $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
    $buffer = New-Object System.Collections.Generic.List[byte]
    foreach ($byte in $utf8Bytes) {
        $buffer.Add($byte)
    }
    $buffer.Add(0)

    $padding = (16 - ($buffer.Count % 16)) % 16
    for ($i = 0; $i -lt $padding; $i++) {
        $buffer.Add(0)
    }

    $words = @()
    $bytes = $buffer.ToArray()
    for ($offset = 0; $offset -lt $bytes.Length; $offset += 16) {
        $chunk = New-Object byte[] 17
        [Array]::Copy($bytes, $offset, $chunk, 0, 16)
        $words += ([System.Numerics.BigInteger]::new($chunk)).ToString()
    }

    return $words
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
    Write-Info ((@($FilePath) + $Arguments) -join " ")
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE"
    }
}

function Invoke-CliCapture([string]$CliPath, [string[]]$Arguments) {
    $output = & $CliPath @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "CLI command failed: $($Arguments -join ' ')"
    }
    return ($output | Out-String).Trim()
}

function Get-RequiredPath([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Label not found: $Path"
    }
    return (Resolve-Path -LiteralPath $Path).Path
}

function Wait-ForBytecode([string]$CliPath, [UInt64]$Tx) {
    $alkaneId = "4:$Tx"
    for ($attempt = 1; $attempt -le 10; $attempt++) {
        try {
            $bytecode = Invoke-CliCapture $CliPath @(
                "-p", "signet",
                "--jsonrpc-url", $JsonRpcUrl,
                "alkanes", "getbytecode", $alkaneId,
                "--raw"
            )
            if (-not [string]::IsNullOrWhiteSpace($bytecode) -and $bytecode -notmatch "null") {
                return
            }
        } catch {
        }

        if ($attempt -lt 10) {
            Start-Sleep -Seconds 2
        }
    }

    throw "Timed out waiting for bytecode at $alkaneId"
}

function Get-SimulatedNumber([string]$CliPath, [string]$CellpackId) {
    $output = Invoke-CliCapture $CliPath @(
        "-p", "signet",
        "--jsonrpc-url", $JsonRpcUrl,
        "alkanes", "simulate", $CellpackId,
        "--format", "number"
    )

    if ($output -notmatch "^\d+$") {
        throw "Expected numeric output from simulate for $CellpackId but received: $output"
    }

    return $output
}

$repoRoot = Get-RepoRoot
Set-Location $repoRoot

$cargo = "cargo"
$cliPath = Join-Path $repoRoot "target\release\alkanes-cli.exe"
$engineTokenWasm = Join-Path $repoRoot "target\wasm32-unknown-unknown\release\engine_token.wasm"
$claimManagerWasm = Join-Path $repoRoot "target\wasm32-unknown-unknown\release\engine_claim_manager.wasm"
$resolvedOutputPath = Join-Path $repoRoot $OutputPath

if (-not (Test-Path -LiteralPath $WalletFile)) {
    throw "Wallet file not found: $WalletFile"
}

Write-Info "Building alkanes-cli and Engine miner WASM artifacts..."
Invoke-Checked $cargo @("build", "--release", "-p", "alkanes-cli")
Invoke-Checked $cargo @("build", "--release", "--target", "wasm32-unknown-unknown", "-p", "engine-token", "-p", "engine-claim-manager")

$cliPath = Get-RequiredPath $cliPath "alkanes-cli"
$engineTokenWasm = Get-RequiredPath $engineTokenWasm "engine-token WASM"
$claimManagerWasm = Get-RequiredPath $claimManagerWasm "engine-claim-manager WASM"

$engineNameWords = Get-CellpackStringWords $TokenName
$engineSymbolWords = Get-CellpackStringWords $TokenSymbol

$engineTokenArgs = @("3", "$EngineTokenTx", "0", "4", "$ClaimManagerTx", "$TokenCap", "$PremineUnits") + $engineNameWords + $engineSymbolWords
$engineTokenProtostone = "[{0}]:v0:v0" -f ($engineTokenArgs -join ",")
$claimManagerProtostone = "[3,{0},0,4,{1},{2}]:v0:v0" -f $ClaimManagerTx, $EngineTokenTx, $SettlementAuthUnits

Write-Info "Deploying EngineToken to [4,$EngineTokenTx]..."
Invoke-Checked $cliPath @(
    "-p", "signet",
    "--wallet-file", $WalletFile,
    "--passphrase", $Passphrase,
    "--jsonrpc-url", $JsonRpcUrl,
    "--esplora-api-url", $EsploraApiUrl,
    "alkanes", "execute", $engineTokenProtostone,
    "--envelope", $engineTokenWasm,
    "--from", $FromAddress,
    "--change", $ChangeAddress,
    "--to", $ToAddress,
    "--fee-rate", "$FeeRate",
    "--auto-confirm"
)
Write-Success "EngineToken deployed at [4,$EngineTokenTx]"

Write-Info "Deploying EngineClaimManager to [4,$ClaimManagerTx]..."
Invoke-Checked $cliPath @(
    "-p", "signet",
    "--wallet-file", $WalletFile,
    "--passphrase", $Passphrase,
    "--jsonrpc-url", $JsonRpcUrl,
    "--esplora-api-url", $EsploraApiUrl,
    "alkanes", "execute", $claimManagerProtostone,
    "--envelope", $claimManagerWasm,
    "--from", $FromAddress,
    "--change", $ChangeAddress,
    "--to", $ToAddress,
    "--fee-rate", "$FeeRate",
    "--auto-confirm"
)
Write-Success "EngineClaimManager deployed at [4,$ClaimManagerTx]"

$authTokenBlock = 4
$authTokenTx = $ClaimManagerTx

$deployment = [ordered]@{
    network = "signet"
    jsonRpcUrl = $JsonRpcUrl
    alkanesRpcUrl = $AlkanesRpcUrl
    engineTokenId = "4:$EngineTokenTx"
    claimManagerId = "4:$ClaimManagerTx"
    claimManagerSettleOpcode = 1
    authTokenId = "${authTokenBlock}:$authTokenTx"
    settlementAuthUnits = $SettlementAuthUnits
    engineMinerEnv = [ordered]@{
        ENGINE_MINER_ALKANES_RPC_URL = $AlkanesRpcUrl
        ENGINE_MINER_SETTLEMENT_CONTRACT_BLOCK = "4"
        ENGINE_MINER_SETTLEMENT_CONTRACT_TX = "$ClaimManagerTx"
        ENGINE_MINER_SETTLEMENT_OPCODE = "1"
        ENGINE_MINER_SETTLEMENT_INPUT_TEMPLATE = "rewardTokens,receiptPayloadHashHi,receiptPayloadHashLo"
        ENGINE_MINER_SETTLEMENT_INPUT_REQUIREMENTS_TEMPLATE = "B:{btcSats}"
        ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_BLOCK = $authTokenBlock
        ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_TX = $authTokenTx
        ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_UNITS = "1"
        ENGINE_MINER_SETTLEMENT_TO_ADDRESSES_TEMPLATE = "{payoutAddress}"
    }
}

$outputDirectory = Split-Path -Parent $resolvedOutputPath
if (-not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}

$deployment | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resolvedOutputPath

Write-Success "Deployment manifest written to $resolvedOutputPath"
Write-Host ""
Write-Host "Engine miner settlement env values:" -ForegroundColor Green
Write-Host "ENGINE_MINER_ALKANES_RPC_URL=$AlkanesRpcUrl"
Write-Host "ENGINE_MINER_SETTLEMENT_CONTRACT_BLOCK=4"
Write-Host "ENGINE_MINER_SETTLEMENT_CONTRACT_TX=$ClaimManagerTx"
Write-Host "ENGINE_MINER_SETTLEMENT_OPCODE=1"
Write-Host "ENGINE_MINER_SETTLEMENT_INPUT_TEMPLATE=rewardTokens,receiptPayloadHashHi,receiptPayloadHashLo"
Write-Host "ENGINE_MINER_SETTLEMENT_INPUT_REQUIREMENTS_TEMPLATE=B:{btcSats}"
Write-Host "ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_BLOCK=$authTokenBlock"
Write-Host "ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_TX=$authTokenTx"
Write-Host "ENGINE_MINER_SETTLEMENT_AUTH_TOKEN_UNITS=1"