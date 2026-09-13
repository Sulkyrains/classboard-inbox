param([string]$Roster,[string]$Committee,[string]$Reset,[switch]$Remote)
$ErrorActionPreference='Stop'
if (!$Reset -and (!$Roster -or !$Committee)) { throw 'Provide Roster and Committee, or Reset student number' }
$secret = Read-Host 'Enter temporary password (hidden)' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $taskArgs = @('scripts/accounts.mjs')
  if ($Reset) { $taskArgs += @('--reset',$Reset) } else { $taskArgs += @('--roster',$Roster,'--committee',$Committee) }
  if ($Remote) { $taskArgs += '--remote' }
  $plain | & node @taskArgs
  if ($LASTEXITCODE -ne 0) { throw 'Account operation failed' }
} finally {
  $plain=$null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  $secret.Dispose()
}
