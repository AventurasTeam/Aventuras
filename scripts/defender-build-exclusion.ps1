<#
  Adds or removes this checkout's Rust build output (src-tauri\target) as a Windows Defender
  real-time scanning exclusion, or lists every exclusion that is an Aventuras build output or has
  "Aventuras" in its path. Defender scanning freshly written archives makes cargo fail with
  "failed to remove temporary directory ... (os error 32)".

  Only the build output is excluded: sources, node_modules and the cargo registry stay scanned.
  Run from an administrator PowerShell; the path follows this script, not the current folder.

    .\scripts\defender-build-exclusion.ps1 -Action Add
    .\scripts\defender-build-exclusion.ps1 -Action Remove
    .\scripts\defender-build-exclusion.ps1 -Action Scan
#>
[CmdletBinding()]
param(
  [ValidateSet('Add', 'Remove', 'Scan')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'

if (-not $Action) {
  @'
Usage: .\scripts\defender-build-exclusion.ps1 -Action <Add|Remove|Scan>

  Add     Exclude this checkout's src-tauri\target from Defender real-time scanning
  Remove  Scan this checkout's src-tauri\target again
  Scan    List every Aventuras build exclusion and whether its checkout still exists

Run from an administrator PowerShell.
'@
  exit 1
}

# Defender keeps each rule as typed, so `...\target\` and `...\target` are the same folder.
# Relative, wildcard and %VAR% rules stay as typed and never match: Defender expands variables as
# LocalSystem, not as this shell's user, and GetFullPath rejects `*` and `?`.
function Get-NormalPath([string]$Path) {
  if (Test-OpaqueRule $Path) {
    return $Path.TrimEnd('\')
  }
  [IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Test-OpaqueRule([string]$Path) {
  $Path -match '[*?%]' -or -not [IO.Path]::IsPathRooted($Path)
}

# Reading the exclusions needs an administrator too: otherwise Defender returns a notice in their place.
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error 'Defender exclusions can only be read or changed from an administrator PowerShell.'
}

try {
  $preference = Get-MpPreference
} catch {
  Write-Error "Could not read the Defender settings; another antivirus may be active, or the Defender service is stopped. $_"
}

# Defender stores the text as given and never resolves a relative path, so it must be absolute.
$target = Get-NormalPath (Join-Path $PSScriptRoot '..\src-tauri\target')
$exclusions = @($preference.ExclusionPath | Where-Object { $_ })
$matching = @($exclusions | Where-Object { (Get-NormalPath $_) -eq $target })

switch ($Action) {
  'Add' {
    if ($matching.Count -gt 0) {
      "Already excluded: $($matching[0])"
    } else {
      Add-MpPreference -ExclusionPath $target
      "Excluded: $target"
    }
  }
  'Remove' {
    if ($matching.Count -gt 0) {
      Remove-MpPreference -ExclusionPath $matching
      $matching | ForEach-Object { "No longer excluded: $_" }
    } else {
      "Was not excluded: $target"
    }
  }
  'Scan' {
    $found = @($exclusions | Where-Object {
        $path = Get-NormalPath $_
        $path -like '*\src-tauri\target' -or $path -like '*Aventuras*'
      })
    if ($found.Count -eq 0) {
      'No exclusion is an Aventuras build output or has "Aventuras" in its path.'
    } else {
      # Without git the folders can still be checked, only not matched to worktrees.
      $worktrees = $null
      try {
        $listed = @(git -C $PSScriptRoot worktree list --porcelain)
        if ($LASTEXITCODE -eq 0) {
          $worktrees = @($listed | Where-Object { $_ -like 'worktree *' } |
              ForEach-Object { Get-NormalPath $_.Substring(9) })
        }
      } catch {}
      if ($null -eq $worktrees) {
        Write-Warning 'git worktree list failed, so checkouts that still exist are listed as unknown.'
      }

      # A missing `target` alone only means a clean; a missing checkout is a rule left behind.
      $rows = $found | ForEach-Object {
        $path = Get-NormalPath $_
        $root = if ($path -like '*\src-tauri\target') { Split-Path (Split-Path $path) } else { $path }
        $status = if (Test-OpaqueRule $path) {
          'unknown'
        } elseif (-not (Test-Path -LiteralPath $root)) {
          'left behind'
        } elseif ($null -eq $worktrees) {
          'unknown'
        } elseif ($worktrees -contains $root) {
          'live'
        } elseif (Test-Path -LiteralPath (Join-Path $root '.git')) {
          'other checkout'
        } else {
          'not a checkout'
        }
        $line = if ($path -eq $target) { "  $_  (this checkout)" } else { "  $_" }
        [pscustomobject]@{ Status = $status; Line = $line }
      }

      $colors = [ordered]@{
        'live' = 'Green'
        'other checkout' = 'Cyan'
        'not a checkout' = 'Yellow'
        'unknown' = 'Yellow'
        'left behind' = 'Red'
      }
      # Write-Host for the lines too, so they cannot fall out of order with the colored headers.
      foreach ($status in $colors.Keys) {
        $group = @($rows | Where-Object Status -eq $status)
        if ($group.Count -gt 0) {
          Write-Host $status -ForegroundColor $colors[$status]
          $group | ForEach-Object { Write-Host $_.Line }
        }
      }
    }
  }
}
