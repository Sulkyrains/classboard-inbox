param([string]$Roster,[string]$Committee,[string]$Reset,[string]$Positions,[switch]$Reissue,[switch]$Status,[switch]$Remote)
$ErrorActionPreference='Stop'
if (!$Status -and !$Reissue -and !$Reset -and !$Positions -and (!$Roster -or !$Committee)) { throw 'Provide Roster and Committee, or Positions, or Reset student number, or Reissue, or Status' }

$taskArgs = @('scripts/accounts.mjs')
if ($Status) { $taskArgs += '--status' }
elseif ($Reissue) { $taskArgs += '--reissue' }
elseif ($Reset) { $taskArgs += @('--reset',$Reset) }
elseif ($Positions) { $taskArgs += @('--positions',$Positions) }
else { $taskArgs += @('--roster',$Roster,'--committee',$Committee) }
if ($Remote) { $taskArgs += '--remote' }

if ($Reset) {
  # Leave the prompt empty to let the tool generate a random temporary password.
  $secret = Read-Host 'Temporary password (leave empty to auto-generate, hidden)' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $plain | & node @taskArgs
  } finally {
    $plain=$null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $secret.Dispose()
  }
} else {
  # Roster import issues a distinct random password per student; nothing to type in.
  & node @taskArgs
}
if ($LASTEXITCODE -ne 0) { throw 'Account operation failed' }
