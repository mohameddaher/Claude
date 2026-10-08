<#
  Security Monitor for Windows
  Checks this computer for viruses and malware, intruders, open ports,
  weak settings (vulnerabilities) and Wi-Fi / home-network threats,
  then writes an HTML report and opens it.

  Usage (from the launchers, or an elevated PowerShell):
    .\SecurityMonitor.ps1                 full check + report
    .\SecurityMonitor.ps1 -QuickScan      also update virus definitions and run a Defender quick scan
    .\SecurityMonitor.ps1 -Watch          keep watching and pop up an alert when something changes
    .\SecurityMonitor.ps1 -Watch -IntervalMinutes 2
#>
param(
  [switch]$Watch,
  [int]$IntervalMinutes = 5,
  [switch]$QuickScan,
  [switch]$NoOpen
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $Root 'data'
$ReportDir = Join-Path $Root 'reports'
New-Item -ItemType Directory -Force -Path $DataDir, $ReportDir | Out-Null

$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

$Findings = New-Object System.Collections.ArrayList
$Details = [ordered]@{}
$SigCache = @{}

function Say($msg) { Write-Host ("  " + $msg) -ForegroundColor Cyan }

function Add-Finding($Area, $Severity, $Title, $Detail, $Fix) {
  [void]$Findings.Add([pscustomobject]@{ Area = $Area; Severity = $Severity; Title = $Title; Detail = $Detail; Fix = $Fix })
}

function Add-Detail($Area, $Heading, $Rows, $Columns) {
  if (-not $Details.Contains($Area)) { $Details[$Area] = New-Object System.Collections.ArrayList }
  [void]$Details[$Area].Add([pscustomobject]@{ Heading = $Heading; Rows = @($Rows); Columns = $Columns })
}

function Load-Json($name) {
  $p = Join-Path $DataDir $name
  if (Test-Path $p) { try { return Get-Content $p -Raw | ConvertFrom-Json } catch { } }
  return $null
}
function Save-Json($name, $obj) { $obj | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $DataDir $name) -Encoding UTF8 }

function Get-Signer($path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return 'File not found' }
  if ($SigCache.ContainsKey($path)) { return $SigCache[$path] }
  $s = Get-AuthenticodeSignature -LiteralPath $path
  $r = 'Unsigned'
  if ($s -and $s.Status -eq 'Valid') { $r = ($s.SignerCertificate.Subject -replace '^CN=("?)([^,"]+).*$', '$2') }
  elseif ($s -and $s.Status -ne 'NotSigned') { $r = 'Bad signature (' + $s.Status + ')' }
  $SigCache[$path] = $r
  return $r
}

function Get-ExePath($cmd) {
  if (-not $cmd) { return $null }
  $c = [Environment]::ExpandEnvironmentVariables([string]$cmd).Trim()
  if ($c.StartsWith('"')) { return $c.Substring(1, $c.IndexOf('"', 1) - 1) }
  $m = [regex]::Match($c, '^(.+?\.(exe|com|bat|cmd|vbs|js|ps1|scr|dll))', 'IgnoreCase')
  if ($m.Success) { return $m.Groups[1].Value }
  return ($c -split ' ')[0]
}

$UserWritable = '\\AppData\\Local\\Temp\\|\\Windows\\Temp\\|\\Users\\Public\\|\\Downloads\\|\\AppData\\Roaming\\[^\\]+\.exe$|\\ProgramData\\[^\\]+\.exe$|\\Recycle'
$ScriptHosts = 'powershell.*(-enc|-e |encodedcommand|downloadstring|iex|invoke-expression|frombase64)|mshta|wscript|cscript|regsvr32.*(http|scrobj)|rundll32.*(javascript|http)|certutil.*(-urlcache|-decode)|bitsadmin.*transfer'

# ---------------------------------------------------------------- Antivirus
function Check-Antivirus {
  $A = 'Viruses & malware'
  Say 'Checking antivirus...'
  $products = Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName AntiVirusProduct
  if ($products) {
    $rows = foreach ($p in $products) {
      $hex = '{0:X6}' -f [int]$p.productState
      [pscustomobject]@{ Product = $p.displayName; Running = $(if ($hex.Substring(2, 2) -in '10', '11') { 'On' } else { 'Off' }); 'Definitions' = $(if ($hex.Substring(4, 2) -eq '00') { 'Up to date' } else { 'Out of date' }) }
    }
    Add-Detail $A 'Installed antivirus' $rows @('Product', 'Running', 'Definitions')
    if (-not ($rows | Where-Object { $_.Running -eq 'On' })) { Add-Finding $A 'Critical' 'No antivirus is switched on' 'Windows reports no running antivirus product.' 'Open Windows Security > Virus & threat protection and turn real-time protection on.' }
  }

  $mp = Get-MpComputerStatus
  if (-not $mp) {
    Add-Detail $A 'Microsoft Defender' @([pscustomobject]@{ Item = 'Status'; Value = 'Not available (another antivirus may be in charge)' }) @('Item', 'Value')
  }
  else {
    if ($QuickScan) {
      Say 'Updating virus definitions...'
      Update-MpSignature | Out-Null
      Say 'Running a Defender quick scan (this takes a few minutes)...'
      Start-MpScan -ScanType QuickScan
      $mp = Get-MpComputerStatus
    }
    $rows = @(
      [pscustomobject]@{ Item = 'Antivirus enabled'; Value = $mp.AntivirusEnabled }
      [pscustomobject]@{ Item = 'Real-time protection'; Value = $mp.RealTimeProtectionEnabled }
      [pscustomobject]@{ Item = 'Tamper protection'; Value = $mp.IsTamperProtected }
      [pscustomobject]@{ Item = 'Virus definitions age'; Value = "$($mp.AntivirusSignatureAge) day(s), version $($mp.AntivirusSignatureVersion)" }
      [pscustomobject]@{ Item = 'Last quick scan'; Value = "$($mp.QuickScanAge) day(s) ago" }
      [pscustomobject]@{ Item = 'Last full scan'; Value = $(if ($mp.FullScanAge -gt 10000) { 'Never' } else { "$($mp.FullScanAge) day(s) ago" }) }
    )
    Add-Detail $A 'Microsoft Defender' $rows @('Item', 'Value')
    if ($mp.AMServiceEnabled -and -not $mp.RealTimeProtectionEnabled) { Add-Finding $A 'High' 'Defender real-time protection is off' 'Viruses can run without being blocked.' 'Windows Security > Virus & threat protection > Manage settings > turn Real-time protection on.' }
    if ($mp.AMServiceEnabled -and $mp.AntivirusSignatureAge -gt 3) { Add-Finding $A 'Medium' "Virus definitions are $($mp.AntivirusSignatureAge) days old" 'New viruses will not be recognised.' 'Run this tool with the "Update & quick scan" launcher, or Windows Security > Protection updates.' }
    if ($mp.AMServiceEnabled -and $mp.QuickScanAge -gt 7) { Add-Finding $A 'Low' "No virus scan for $($mp.QuickScanAge) days" 'Regular scans catch anything real-time protection missed.' 'Use the "Update & quick scan" launcher.' }
    if ($mp.AMServiceEnabled -and $mp.IsTamperProtected -eq $false) { Add-Finding $A 'Medium' 'Tamper protection is off' 'Malware can switch Defender off.' 'Windows Security > Virus & threat protection > Manage settings > Tamper Protection: On.' }

    $pref = Get-MpPreference
    $ex = @($pref.ExclusionPath) + @($pref.ExclusionProcess) + @($pref.ExclusionExtension) | Where-Object { $_ }
    if ($ex.Count) {
      Add-Detail $A 'Defender exclusions (not scanned)' ($ex | ForEach-Object { [pscustomobject]@{ Exclusion = $_ } }) @('Exclusion')
      Add-Finding $A 'Medium' "$($ex.Count) folder(s)/file type(s) are excluded from virus scanning" (($ex | Select-Object -First 5) -join '; ') 'Remove any exclusion you did not add yourself: Windows Security > Manage settings > Exclusions. Malware often adds itself here.'
    }

    $threats = @{}
    Get-MpThreat | ForEach-Object { $threats[[string]$_.ThreatID] = $_ }
    $det = Get-MpThreatDetection | Sort-Object InitialDetectionTime -Descending | Select-Object -First 40
    if ($det) {
      $rows = foreach ($d in $det) {
        $t = $threats[[string]$d.ThreatID]
        [pscustomobject]@{ When = $d.InitialDetectionTime; Threat = $(if ($t) { $t.ThreatName } else { $d.ThreatID }); Where = (($d.Resources | Select-Object -First 2) -join '; '); Removed = $(if ($d.ActionSuccess) { 'Yes' } else { 'NO' }) }
      }
      Add-Detail $A 'Threats Defender has found' $rows @('When', 'Threat', 'Where', 'Removed')
    }
    $active = @(Get-MpThreat | Where-Object { $_.IsActive })
    foreach ($t in $active) { Add-Finding $A 'Critical' "Active threat: $($t.ThreatName)" (($t.Resources | Select-Object -First 3) -join '; ') 'Windows Security > Protection history > choose the threat > Remove. Then run a full scan or Microsoft Defender Offline scan.' }
    $recent = @($det | Where-Object { $_.InitialDetectionTime -gt (Get-Date).AddDays(-7) })
    if ($recent.Count -and -not $active.Count) { Add-Finding $A 'Low' "$($recent.Count) threat(s) caught in the last 7 days" 'Defender reports them as handled.' 'Check Protection history and think about where they came from (USB stick, download, email).' }
  }
}

# ---------------------------------------------------------------- Suspicious programs
function Check-Malware {
  $A = 'Viruses & malware'
  Say 'Looking for suspicious programs, startup items and scheduled tasks...'
  $winDir = $env:windir

  $procs = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath }
  $sus = foreach ($p in $procs) {
    $path = $p.ExecutablePath
    if ($path -like "$winDir\*" -and $path -notmatch $UserWritable) { continue }
    $signer = Get-Signer $path
    $reasons = @()
    if ($path -match $UserWritable) { $reasons += 'runs from a temporary/public folder' }
    if ($signer -ne 'File not found' -and $signer -match '^Unsigned|^Bad') { $reasons += $signer.ToLower() }
    if ($p.CommandLine -match $ScriptHosts) { $reasons += 'hidden/encoded script command' }
    if ($reasons.Count -ge 1 -and ($path -match $UserWritable -or $reasons.Count -ge 2 -or $p.CommandLine -match $ScriptHosts)) {
      [pscustomobject]@{ Program = $p.Name; PID = $p.ProcessId; Path = $path; Why = ($reasons -join ', ') }
    }
  }
  # script engines with encoded/download commands even when signed (powershell.exe etc.)
  $sus = @($sus) + @($procs | Where-Object { $_.CommandLine -match $ScriptHosts -and $_.ExecutablePath -like "$winDir\*" } | ForEach-Object {
      [pscustomobject]@{ Program = $_.Name; PID = $_.ProcessId; Path = $_.CommandLine; Why = 'hidden/encoded script command' } })
  $sus = @($sus | Where-Object { $_ })
  if ($sus.Count) {
    Add-Detail $A 'Suspicious running programs' $sus @('Program', 'PID', 'Path', 'Why')
    foreach ($s in $sus) { Add-Finding $A 'High' "Suspicious program running: $($s.Program)" "$($s.Path) - $($s.Why)" 'If you do not recognise it: end it in Task Manager, upload the file to virustotal.com, and run a full Defender scan.' }
  }

  $start = Get-CimInstance Win32_StartupCommand
  $rows = foreach ($s in $start) {
    $exe = Get-ExePath $s.Command
    $signer = Get-Signer $exe
    $flag = ''
    if ($exe -match $UserWritable -or $s.Command -match $ScriptHosts) { $flag = 'SUSPICIOUS' } elseif ($signer -match '^Unsigned|^Bad') { $flag = 'Unsigned' }
    [pscustomobject]@{ Name = $s.Name; Command = $s.Command; Where = $s.Location; Signer = $signer; Flag = $flag }
  }
  if ($rows) {
    Add-Detail $A 'Programs that start with Windows' $rows @('Name', 'Command', 'Where', 'Signer', 'Flag')
    foreach ($r in $rows | Where-Object { $_.Flag -eq 'SUSPICIOUS' }) { Add-Finding $A 'High' "Suspicious startup item: $($r.Name)" $r.Command 'Task Manager > Startup apps > Disable it, then scan the file.' }
    foreach ($r in $rows | Where-Object { $_.Flag -eq 'Unsigned' }) { Add-Finding $A 'Low' "Unsigned program starts with Windows: $($r.Name)" $r.Command 'Fine if you know it; otherwise disable it in Task Manager > Startup apps.' }
  }

  $tasks = Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' -and $_.State -ne 'Disabled' }
  $rows = foreach ($t in $tasks) {
    foreach ($act in $t.Actions) {
      if (-not $act.Execute) { continue }
      $cmd = ($act.Execute + ' ' + $act.Arguments).Trim()
      $exe = Get-ExePath $act.Execute
      $signer = Get-Signer $exe
      $flag = ''
      if ($cmd -match $ScriptHosts -or $exe -match $UserWritable) { $flag = 'SUSPICIOUS' } elseif ($signer -match '^Unsigned|^Bad') { $flag = 'Unsigned' }
      [pscustomobject]@{ Task = ($t.TaskPath + $t.TaskName); Command = $cmd; Signer = $signer; Flag = $flag }
    }
  }
  if ($rows) {
    Add-Detail $A 'Scheduled tasks (non-Microsoft)' $rows @('Task', 'Command', 'Signer', 'Flag')
    foreach ($r in $rows | Where-Object { $_.Flag -eq 'SUSPICIOUS' }) { Add-Finding $A 'High' "Suspicious scheduled task: $($r.Task)" $r.Command 'Open Task Scheduler, find the task, Disable it, and scan the file it runs.' }
  }

  $hosts = Get-Content "$winDir\System32\drivers\etc\hosts" | Where-Object { $_ -match '^\s*[^#\s]' -and $_ -notmatch 'localhost' }
  if ($hosts) {
    Add-Detail $A 'Custom entries in the hosts file' ($hosts | ForEach-Object { [pscustomobject]@{ Entry = $_ } }) @('Entry')
    Add-Finding $A 'Medium' "Hosts file has $(@($hosts).Count) custom entr(y/ies)" ((@($hosts) | Select-Object -First 3) -join '; ') 'Malware edits this file to send you to fake websites. Remove lines you did not add (C:\Windows\System32\drivers\etc\hosts).'
  }
  $ie = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
  if ($ie.ProxyEnable -eq 1) { Add-Finding $A 'Medium' "A web proxy is set: $($ie.ProxyServer)" 'All browsing goes through this server. Some malware sets one to spy on traffic.' 'Settings > Network & internet > Proxy: turn it off unless your workplace set it.' }
}

# ---------------------------------------------------------------- Intruders
function Check-Intruders {
  $A = 'Intruders & accounts'
  Say 'Checking sign-ins, accounts and remote access...'
  if ($IsAdmin) {
    $fails = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625; StartTime = (Get-Date).AddDays(-1) } -MaxEvents 5000
    $fails = @($fails)
    if ($fails.Count) {
      $grp = $fails | ForEach-Object { [pscustomobject]@{ User = $_.Properties[5].Value; From = $_.Properties[19].Value } } | Group-Object User, From | Sort-Object Count -Descending
      Add-Detail $A 'Failed sign-ins in the last 24 hours' ($grp | ForEach-Object { [pscustomobject]@{ 'Account, from' = $_.Name; Attempts = $_.Count } }) @('Account, from', 'Attempts')
      $sev = if ($fails.Count -ge 20) { 'High' } elseif ($fails.Count -ge 5) { 'Medium' } else { 'Low' }
      Add-Finding $A $sev "$($fails.Count) failed sign-in attempt(s) in the last 24 hours" "Most from: $($grp[0].Name)" 'If this was not you mistyping your password, someone is guessing it. Use a strong password and turn off Remote Desktop if you do not need it.'
    }
    $logons = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4624; StartTime = (Get-Date).AddDays(-7) } -MaxEvents 4000 | Where-Object {
      $lt = [int]$_.Properties[8].Value; $ip = [string]$_.Properties[18].Value
      ($lt -eq 10) -or ($lt -eq 3 -and $ip -and $ip -notin '-', '::1', '127.0.0.1' -and [string]$_.Properties[5].Value -notmatch '\$$|^ANONYMOUS')
    }
    if ($logons) {
      $rows = $logons | Select-Object -First 50 | ForEach-Object { [pscustomobject]@{ When = $_.TimeCreated; Account = $_.Properties[5].Value; From = $_.Properties[18].Value; Type = $(if ([int]$_.Properties[8].Value -eq 10) { 'Remote Desktop' } else { 'Network' }) } }
      Add-Detail $A 'Remote sign-ins in the last 7 days' $rows @('When', 'Account', 'From', 'Type')
      $rdp = @($rows | Where-Object { $_.Type -eq 'Remote Desktop' })
      if ($rdp.Count) { Add-Finding $A 'High' "$($rdp.Count) Remote Desktop sign-in(s) in the last 7 days" "Latest: $($rdp[0].Account) from $($rdp[0].From) at $($rdp[0].When)" 'If you did not do this, change your password now and turn Remote Desktop off.' }
    }
    $acct = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4720, 4732, 4728; StartTime = (Get-Date).AddDays(-30) } -MaxEvents 200
    foreach ($e in $acct) {
      $what = if ($e.Id -eq 4720) { "New user account created: $($e.Properties[0].Value)" } else { "Account added to group $($e.Properties[2].Value)" }
      Add-Finding $A 'High' $what "On $($e.TimeCreated)" 'If you did not do this, an intruder may have created a back door. Remove the account in Settings > Accounts.'
    }
  }
  else {
    Add-Finding $A 'Info' 'Sign-in history not checked' 'Reading the security log needs administrator rights.' 'Start the tool with the launcher and answer Yes to the administrator prompt.'
  }

  $users = Get-LocalUser
  if ($users) {
    $admins = @(Get-LocalGroupMember -SID 'S-1-5-32-544' | ForEach-Object { ($_.Name -split '\\')[-1] })
    $rows = $users | ForEach-Object { [pscustomobject]@{ Account = $_.Name; Enabled = $_.Enabled; Administrator = ($admins -contains $_.Name); 'Password required' = $_.PasswordRequired; 'Last sign-in' = $_.LastLogon } }
    Add-Detail $A 'Local accounts' $rows @('Account', 'Enabled', 'Administrator', 'Password required', 'Last sign-in')
    foreach ($u in $users | Where-Object { $_.Enabled -and $_.SID -like '*-501' }) { Add-Finding $A 'High' 'The Guest account is switched on' 'Anyone can sign in without a password.' 'Run: net user guest /active:no' }
    foreach ($u in $users | Where-Object { $_.Enabled -and -not $_.PasswordRequired -and $_.SID -notlike '*-501' }) { Add-Finding $A 'Medium' "Account '$($u.Name)' may not need a password" 'Accounts without a password are easy to break into.' 'Settings > Accounts > Sign-in options: set a password.' }
    $enAdmins = @($users | Where-Object { $_.Enabled -and $admins -contains $_.Name })
    if ($enAdmins.Count -gt 2) { Add-Finding $A 'Low' "$($enAdmins.Count) accounts have administrator rights" (($enAdmins.Name) -join ', ') 'Remove administrator rights from accounts that do not need them.' }
  }

  $ts = Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server'
  if ($ts -and $ts.fDenyTSConnections -eq 0) {
    $nla = (Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp').UserAuthentication
    Add-Finding $A $(if ($nla -eq 1) { 'Medium' } else { 'High' }) 'Remote Desktop is turned on' $(if ($nla -eq 1) { 'Others on the network can try to sign in to this PC.' } else { 'And Network Level Authentication is OFF, which makes attacks easier.' }) 'Settings > System > Remote Desktop: Off, unless you really use it.'
  }
  $sess = quser 2>$null
  if ($sess) { Add-Detail $A 'Who is signed in right now' ($sess | ForEach-Object { [pscustomobject]@{ Session = $_ } }) @('Session') }

  $conns = Get-NetTCPConnection -State Established | Where-Object { $_.RemoteAddress -notmatch '^(127\.|::1|0\.0\.0\.0)' }
  if ($conns) {
    $pn = @{}; Get-Process | ForEach-Object { $pn[$_.Id] = $_.ProcessName }
    $rows = $conns | Sort-Object OwningProcess | Select-Object -First 150 | ForEach-Object { [pscustomobject]@{ Program = $pn[[int]$_.OwningProcess]; 'Remote address' = "$($_.RemoteAddress):$($_.RemotePort)"; 'Local port' = $_.LocalPort } }
    Add-Detail $A 'Live internet connections' $rows @('Program', 'Remote address', 'Local port')
    $inbound = @($conns | Where-Object { $_.LocalPort -in 3389, 5900, 5938, 22, 23, 445, 5985 })
    foreach ($c in $inbound) { Add-Finding $A 'High' "Someone is connected in to port $($c.LocalPort)" "From $($c.RemoteAddress)" 'Port 3389 = Remote Desktop, 5900 = VNC, 5938 = TeamViewer, 22 = SSH, 445 = file sharing. If you do not expect this, disconnect the network and change passwords.' }
  }
}

# ---------------------------------------------------------------- Ports
$RiskyPorts = @{
  21 = 'FTP (unencrypted file transfer)'; 22 = 'SSH remote login'; 23 = 'Telnet (unencrypted remote login)'; 25 = 'Mail server'; 135 = 'Windows RPC'; 139 = 'NetBIOS file sharing'
  445 = 'Windows file sharing (SMB)'; 1433 = 'SQL Server'; 3306 = 'MySQL'; 3389 = 'Remote Desktop'; 5900 = 'VNC remote control'; 5938 = 'TeamViewer'; 5985 = 'WinRM remote management'
  5986 = 'WinRM remote management'; 4444 = 'Common hacker back-door port'; 1337 = 'Common hacker back-door port'; 31337 = 'Common hacker back-door port'; 6667 = 'IRC (used by botnets)'; 12345 = 'Common trojan port'
}
function Get-ListeningPorts {
  $pn = @{}; Get-Process | ForEach-Object { $pn[$_.Id] = $_ }
  $tcp = Get-NetTCPConnection -State Listen | ForEach-Object { [pscustomobject]@{ Proto = 'TCP'; Address = $_.LocalAddress; Port = [int]$_.LocalPort; PID = [int]$_.OwningProcess } }
  $udp = Get-NetUDPEndpoint | Where-Object { $_.LocalAddress -in '0.0.0.0', '::' -and $_.LocalPort -lt 49152 } | ForEach-Object { [pscustomobject]@{ Proto = 'UDP'; Address = $_.LocalAddress; Port = [int]$_.LocalPort; PID = [int]$_.OwningProcess } }
  @($tcp) + @($udp) | Where-Object { $_ } | Sort-Object Proto, Port, Address -Unique | ForEach-Object {
    $p = $pn[$_.PID]
    [pscustomobject]@{ Proto = $_.Proto; Port = $_.Port; Address = $_.Address; Program = $(if ($p) { $p.ProcessName } else { "PID $($_.PID)" }); Path = $(if ($p) { $p.Path } else { '' })
      'Open to network' = $(if ($_.Address -in '0.0.0.0', '::') { 'Yes' } elseif ($_.Address -match '^(127\.|::1)') { 'No (this PC only)' } else { 'Yes' }); Note = $RiskyPorts[$_.Port] }
  }
}
function Check-Ports {
  $A = 'Open ports'
  Say 'Checking open ports...'
  $ports = @(Get-ListeningPorts)
  Add-Detail $A 'Ports this computer is listening on' $ports @('Proto', 'Port', 'Address', 'Open to network', 'Program', 'Note')
  $open = $ports | Where-Object { $_.'Open to network' -eq 'Yes' -and $_.Proto -eq 'TCP' }
  foreach ($p in $open | Where-Object { $_.Port -in 4444, 1337, 31337, 6667, 12345 }) { Add-Finding $A 'Critical' "Port $($p.Port) is open - $($p.Note)" "Program: $($p.Program) $($p.Path)" 'Disconnect from the network, end the program in Task Manager, and run a full virus scan.' }
  foreach ($p in $open | Where-Object { $_.Port -in 21, 23, 5900 }) { Add-Finding $A 'High' "Port $($p.Port) is open - $($p.Note)" "Program: $($p.Program)" 'Uninstall or stop this service unless you need it.' }
  foreach ($p in $open | Where-Object { $_.Port -in 3389, 5938, 22, 5985, 5986, 1433, 3306 } | Sort-Object Port -Unique) { Add-Finding $A 'Medium' "Port $($p.Port) is open - $($p.Note)" "Program: $($p.Program)" 'Close it if you do not use it, and make sure the firewall blocks it on public networks.' }
  foreach ($p in $open | Where-Object { $_.Path -match $UserWritable } | Sort-Object Port -Unique) { Add-Finding $A 'High' "Program in a temporary folder is listening on port $($p.Port)" $p.Path 'This is typical of malware. End it and scan the file.' }

  $base = Load-Json 'known-ports.json'
  $keys = @($ports | Where-Object { $_.'Open to network' -eq 'Yes' } | ForEach-Object { "$($_.Proto)/$($_.Port)/$($_.Program)" } | Sort-Object -Unique)
  if ($base) {
    $new = @($keys | Where-Object { $base -notcontains $_ })
    foreach ($k in $new) { Add-Finding $A 'Medium' "New open port since last check: $k" 'A program started accepting connections from the network.' 'Make sure you recognise the program.' }
  }
  Save-Json 'known-ports.json' $keys
}

# ---------------------------------------------------------------- Vulnerabilities
function Check-Vulnerabilities {
  $A = 'Weak settings & updates'
  Say 'Checking Windows updates, firewall and security settings...'
  $os = Get-CimInstance Win32_OperatingSystem
  $rows = New-Object System.Collections.ArrayList
  [void]$rows.Add([pscustomobject]@{ Item = 'Windows'; Value = "$($os.Caption) (build $($os.BuildNumber))" })
  if ($os.Caption -match 'Windows (7|8|XP|Vista)') { Add-Finding $A 'Critical' "$($os.Caption) no longer gets security updates" 'Known holes will never be fixed.' 'Upgrade to Windows 11.' }
  elseif ($os.Caption -match 'Windows 10') { Add-Finding $A 'High' 'Windows 10 support ended on 14 October 2025' 'Unless this PC is enrolled in Extended Security Updates, new holes are not being fixed.' 'Upgrade to Windows 11, or enrol in Extended Security Updates (Settings > Windows Update).' }

  foreach ($fw in Get-NetFirewallProfile) {
    [void]$rows.Add([pscustomobject]@{ Item = "Firewall ($($fw.Name))"; Value = $(if ($fw.Enabled) { 'On' } else { 'OFF' }) })
    if (-not $fw.Enabled) { Add-Finding $A 'High' "Firewall is off for $($fw.Name) networks" 'Anyone on the network can reach open ports.' 'Windows Security > Firewall & network protection: turn it on.' }
  }

  $hf = Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
  if ($hf) {
    $age = [int]((Get-Date) - $hf.InstalledOn).TotalDays
    [void]$rows.Add([pscustomobject]@{ Item = 'Last Windows update installed'; Value = "$($hf.HotFixID) on $($hf.InstalledOn.ToString('d MMM yyyy')) ($age days ago)" })
    if ($age -gt 45) { Add-Finding $A 'High' "No Windows update installed for $age days" 'Security holes found since then are not fixed.' 'Settings > Windows Update > Check for updates.' }
    elseif ($age -gt 30) { Add-Finding $A 'Medium' "No Windows update installed for $age days" '' 'Settings > Windows Update > Check for updates.' }
  }
  Say 'Asking Windows Update for missing updates (can take a minute)...'
  try {
    $searcher = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
    $res = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
    $pending = @($res.Updates | ForEach-Object { $_ })
    [void]$rows.Add([pscustomobject]@{ Item = 'Updates waiting to install'; Value = $pending.Count })
    if ($pending.Count) {
      Add-Detail $A 'Updates waiting to install' ($pending | ForEach-Object { [pscustomobject]@{ Update = $_.Title; Severity = $_.MsrcSeverity } }) @('Update', 'Severity')
      $crit = @($pending | Where-Object { $_.MsrcSeverity -in 'Critical', 'Important' })
      Add-Finding $A $(if ($crit.Count) { 'High' } else { 'Medium' }) "$($pending.Count) Windows update(s) not installed" (($pending | Select-Object -First 3 | ForEach-Object { $_.Title }) -join '; ') 'Settings > Windows Update > Install all, then restart.'
    }
  } catch { [void]$rows.Add([pscustomobject]@{ Item = 'Updates waiting to install'; Value = 'Could not ask Windows Update' }) }

  $uac = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System').EnableLUA
  [void]$rows.Add([pscustomobject]@{ Item = 'User Account Control'; Value = $(if ($uac -eq 0) { 'OFF' } else { 'On' }) })
  if ($uac -eq 0) { Add-Finding $A 'High' 'User Account Control is switched off' 'Programs get administrator rights without asking.' 'Search "UAC" in Start > set the slider to the default level, restart.' }

  $smb = Get-SmbServerConfiguration
  if ($smb) {
    [void]$rows.Add([pscustomobject]@{ Item = 'SMBv1 (old file sharing)'; Value = $(if ($smb.EnableSMB1Protocol) { 'ON' } else { 'Off' }) })
    if ($smb.EnableSMB1Protocol) { Add-Finding $A 'High' 'Old SMBv1 file sharing is on' 'This is how WannaCry ransomware spread.' 'Run as admin: Set-SmbServerConfiguration -EnableSMB1Protocol $false' }
  }
  $bl = Get-BitLockerVolume -MountPoint $env:SystemDrive
  if ($bl) {
    [void]$rows.Add([pscustomobject]@{ Item = 'Disk encryption (BitLocker)'; Value = [string]$bl.ProtectionStatus })
    if ([string]$bl.ProtectionStatus -ne 'On') { Add-Finding $A 'Low' 'The system disk is not encrypted' 'If the laptop is stolen, files can be read.' 'Settings > Privacy & security > Device encryption (or BitLocker): On.' }
  }
  $sb = Confirm-SecureBootUEFI
  if ($sb -ne $null) { [void]$rows.Add([pscustomobject]@{ Item = 'Secure Boot'; Value = $(if ($sb) { 'On' } else { 'Off' }) }); if (-not $sb) { Add-Finding $A 'Low' 'Secure Boot is off' 'Boot-level malware (rootkits) is easier to install.' 'Turn on Secure Boot in the BIOS/UEFI settings.' } }
  $rr = Get-Service RemoteRegistry
  if ($rr -and $rr.Status -eq 'Running') { Add-Finding $A 'Medium' 'Remote Registry service is running' 'Other computers can read and change settings on this PC.' 'Services > Remote Registry > Stop and set to Disabled.' }
  $ps2 = Get-WindowsOptionalFeature -Online -FeatureName MicrosoftWindowsPowerShellV2Root
  if ($ps2 -and $ps2.State -eq 'Enabled') { Add-Finding $A 'Low' 'Old PowerShell 2.0 is installed' 'Attackers use it to avoid security logging.' 'Turn Windows features on or off > untick Windows PowerShell 2.0.' }
  Add-Detail $A 'Security settings' $rows @('Item', 'Value')
}

# ---------------------------------------------------------------- Wi-Fi & network
function Parse-Netsh($lines) {
  $o = [ordered]@{}
  foreach ($l in $lines) { if ($l -match '^\s*([^:]+?)\s*:\s(.*)$') { $k = $Matches[1].Trim(); if (-not $o.Contains($k)) { $o[$k] = $Matches[2].Trim() } } }
  return $o
}
function Get-WifiNow {
  $i = Parse-Netsh (netsh wlan show interfaces)
  if (-not $i['SSID']) { return $null }
  [pscustomobject]@{ SSID = $i['SSID']; BSSID = (@($i['AP BSSID'], $i['BSSID']) | Where-Object { $_ } | Select-Object -First 1); Auth = $i['Authentication']; Cipher = $i['Cipher']; Signal = $i['Signal']; Radio = $i['Radio type']; Channel = $i['Channel']; Band = $i['Band'] }
}
function Get-WifiNearby {
  $out = netsh wlan show networks mode=bssid
  $list = New-Object System.Collections.ArrayList
  $cur = $null
  foreach ($l in $out) {
    if ($l -match '^SSID \d+ : (.*)$') { $cur = [pscustomobject]@{ SSID = $Matches[1].Trim(); Auth = ''; Encryption = ''; BSSIDs = 0; Signal = '' }; [void]$list.Add($cur) }
    elseif ($cur -and $l -match '^\s*Authentication\s*:\s*(.*)$') { $cur.Auth = $Matches[1].Trim() }
    elseif ($cur -and $l -match '^\s*Encryption\s*:\s*(.*)$') { $cur.Encryption = $Matches[1].Trim() }
    elseif ($cur -and $l -match '^\s*BSSID \d+\s*:') { $cur.BSSIDs++ }
    elseif ($cur -and $l -match '^\s*Signal\s*:\s*(.*)$' -and -not $cur.Signal) { $cur.Signal = $Matches[1].Trim() }
  }
  return , $list
}
function Get-Lan {
  $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
  if (-not $route) { return $null }
  $ip = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Select-Object -First 1
  return [pscustomobject]@{ IfIndex = $route.InterfaceIndex; Gateway = $route.NextHop; IP = $ip.IPAddress; Prefix = $ip.PrefixLength; Alias = $route.InterfaceAlias }
}
function Get-LanDevices($lan, [switch]$Sweep) {
  if ($Sweep -and $lan.IP) {
    $base = ($lan.IP -split '\.')[0..2] -join '.'
    $tasks = 1..254 | ForEach-Object { (New-Object System.Net.NetworkInformation.Ping).SendPingAsync("$base.$_", 400) }
    try { [void][System.Threading.Tasks.Task]::WaitAll($tasks, 5000) } catch { }
  }
  Get-NetNeighbor -InterfaceIndex $lan.IfIndex -AddressFamily IPv4 | Where-Object {
    $_.LinkLayerAddress -and $_.LinkLayerAddress -notmatch '^(00-00-00-00-00-00|FF-FF-FF-FF-FF-FF|01-00-5E)' -and $_.State -ne 'Unreachable' -and $_.IPAddress -notmatch '\.255$'
  } | ForEach-Object {
    $mac = $_.LinkLayerAddress.ToUpper()
    [pscustomobject]@{ IP = $_.IPAddress; MAC = $mac; Random = ('26AE'.Contains($mac.Substring(1, 1))) }
  }
}
function Check-Wifi {
  $A = 'Wi-Fi & network'
  Say 'Checking Wi-Fi and devices on your network...'
  $w = Get-WifiNow
  $rows = New-Object System.Collections.ArrayList
  if ($w) {
    foreach ($k in 'SSID', 'BSSID', 'Auth', 'Cipher', 'Signal', 'Radio', 'Band', 'Channel') { if ($w.$k) { [void]$rows.Add([pscustomobject]@{ Item = $(switch ($k) { 'SSID' { 'Network name' } 'BSSID' { 'Router (BSSID)' } 'Auth' { 'Security' } 'Cipher' { 'Encryption' } default { $k } }); Value = $w.$k }) } }
    if ($w.Auth -match 'Open') { Add-Finding $A 'High' "You are on an open Wi-Fi network ($($w.SSID))" 'Traffic is not encrypted; others nearby can see it.' 'Avoid logging in to anything important; use a VPN, or set a WPA2/WPA3 password on the router.' }
    elseif ($w.Auth -match 'WEP' -or $w.Cipher -match 'WEP') { Add-Finding $A 'High' "Wi-Fi '$($w.SSID)' uses WEP" 'WEP can be cracked in minutes.' 'Change the router security to WPA2-Personal (AES) or WPA3.' }
    elseif ($w.Auth -match '^WPA-|^WPA$' -or $w.Cipher -match 'TKIP') { Add-Finding $A 'Medium' "Wi-Fi '$($w.SSID)' uses old WPA/TKIP security" 'Weaker than WPA2/WPA3.' 'Change the router security to WPA2-Personal (AES) or WPA3.' }
  }
  else { [void]$rows.Add([pscustomobject]@{ Item = 'Wi-Fi'; Value = 'Not connected to Wi-Fi (or no Wi-Fi adapter)' }) }

  $lan = Get-Lan
  if ($lan) {
    [void]$rows.Add([pscustomobject]@{ Item = 'This PC'; Value = "$($lan.IP)/$($lan.Prefix) on $($lan.Alias)" })
    [void]$rows.Add([pscustomobject]@{ Item = 'Router (gateway)'; Value = $lan.Gateway })
    $dns = (Get-DnsClientServerAddress -InterfaceIndex $lan.IfIndex -AddressFamily IPv4).ServerAddresses -join ', '
    [void]$rows.Add([pscustomobject]@{ Item = 'DNS servers'; Value = $dns })
  }
  Add-Detail $A 'Current connection' $rows @('Item', 'Value')

  $near = Get-WifiNearby
  if ($near.Count) {
    Add-Detail $A 'Wi-Fi networks nearby' $near @('SSID', 'Auth', 'Encryption', 'BSSIDs', 'Signal')
    if ($w) {
      $twins = @($near | Where-Object { $_.SSID -eq $w.SSID -and $_.Auth -and $_.Auth -ne $w.Auth })
      foreach ($t in $twins) { Add-Finding $A 'High' "Possible fake copy of your Wi-Fi ('$($t.SSID)')" "A network with the same name uses '$($t.Auth)' while yours uses '$($w.Auth)'." 'This is an "evil twin" trick. Do not connect to it; forget and re-add your network with its password.' }
    }
  }
  elseif ((netsh wlan show networks) -match 'location') { Add-Finding $A 'Info' 'Nearby Wi-Fi list blocked by Windows' 'Windows needs Location permission to list nearby networks.' 'Settings > Privacy & security > Location: turn on, and allow desktop apps.' }

  $profiles = netsh wlan show profiles | ForEach-Object { if ($_ -match 'All User Profile\s*:\s*(.+)$') { $Matches[1].Trim() } }
  $prow = foreach ($p in $profiles) {
    $info = Parse-Netsh (netsh wlan show profile name="$p")
    [pscustomobject]@{ Network = $p; Security = $info['Authentication']; 'Connects automatically' = $info['Connection mode'] }
  }
  if ($prow) {
    Add-Detail $A 'Saved Wi-Fi networks' $prow @('Network', 'Security', 'Connects automatically')
    foreach ($p in $prow | Where-Object { $_.Security -match 'Open' -and $_.'Connects automatically' -match 'automatic' }) { Add-Finding $A 'Medium' "Saved open network '$($p.Network)' connects automatically" 'Anyone can create a fake network with this name and your PC will join it.' "Run: netsh wlan delete profile name=`"$($p.Network)`"" }
  }

  if ($lan) {
    $devs = @(Get-LanDevices $lan -Sweep)
    $known = Load-Json 'known-devices.json'
    $knownMacs = @(); if ($known) { $knownMacs = @($known.MAC) }
    $gwMac = ($devs | Where-Object { $_.IP -eq $lan.Gateway } | Select-Object -First 1).MAC
    $rowsD = foreach ($d in $devs) {
      [pscustomobject]@{ IP = $d.IP; MAC = $d.MAC; What = $(if ($d.IP -eq $lan.Gateway) { 'Router' } elseif ($d.Random) { 'Phone/laptop (private MAC)' } else { '' }); New = $(if ($known -and $knownMacs -notcontains $d.MAC) { 'NEW' } else { '' }) }
    }
    Add-Detail $A "Devices on your network ($($devs.Count))" $rowsD @('IP', 'MAC', 'What', 'New')
    if ($known) {
      foreach ($n in $rowsD | Where-Object { $_.New }) { Add-Finding $A 'Medium' "New device joined your network: $($n.IP)" "MAC $($n.MAC)" 'If you do not recognise it, change the Wi-Fi password and check the router''s connected-devices list.' }
    }
    else { Add-Finding $A 'Info' "$($devs.Count) device(s) found on your network" 'First check: these are remembered, and new ones will be flagged next time.' 'Look at the list and make sure you recognise each device.' }
    $all = @($devs) + @($known | Where-Object { $_ -and $knownMacs -contains $_.MAC -and -not ($devs.MAC -contains $_.MAC) })
    Save-Json 'known-devices.json' @($all | Select-Object IP, MAC)

    if ($gwMac) {
      $dupe = @($devs | Where-Object { $_.MAC -eq $gwMac -and $_.IP -ne $lan.Gateway })
      if ($dupe.Count) { Add-Finding $A 'Critical' 'Another device is pretending to be your router' "$(@($dupe.IP) -join ', ') share the router's MAC $gwMac." 'This is ARP spoofing (someone intercepting your traffic). Disconnect, restart the router and change the Wi-Fi password.' }
      $gwStore = Load-Json 'gateway.json'
      $key = if ($w) { $w.SSID } else { $lan.Alias }
      $prev = $null; if ($gwStore) { $prev = $gwStore.$key }
      if ($prev -and $prev -ne $gwMac) { Add-Finding $A 'High' 'Your router''s hardware address changed' "Was $prev, now $gwMac on '$key'." 'Fine if you replaced the router; otherwise someone may be intercepting your traffic.' }
      $h = @{}; if ($gwStore) { $gwStore.PSObject.Properties | ForEach-Object { $h[$_.Name] = $_.Value } }
      $h[$key] = $gwMac
      Save-Json 'gateway.json' $h
    }
  }
}

# ---------------------------------------------------------------- Report
function Enc($s) { [System.Net.WebUtility]::HtmlEncode([string]$s) }
function Write-Report {
  $order = @{ Critical = 0; High = 1; Medium = 2; Low = 3; Info = 4 }
  $weights = @{ Critical = 25; High = 12; Medium = 5; Low = 2; Info = 0 }
  $score = 100; foreach ($f in $Findings) { $score -= $weights[$f.Severity] }; if ($score -lt 0) { $score = 0 }
  $grade = if ($score -ge 85) { 'Good' } elseif ($score -ge 60) { 'Needs attention' } else { 'At risk' }
  $gradeCls = if ($score -ge 85) { 'g' } elseif ($score -ge 60) { 'm' } else { 'b' }
  $areas = 'Viruses & malware', 'Intruders & accounts', 'Open ports', 'Weak settings & updates', 'Wi-Fi & network'
  $sorted = $Findings | Sort-Object @{ e = { $order[$_.Severity] } }, Area

  $sb = New-Object System.Text.StringBuilder
  $null = $sb.Append(@"
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Security Report - $(Enc $env:COMPUTERNAME)</title>
<style>
:root{--bg:#f4f6fa;--card:#fff;--ink:#14203a;--muted:#5f6c86;--line:#dfe5ef;--crit:#b91c1c;--high:#dc2626;--med:#d97706;--low:#2563eb;--info:#64748b;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--card:#131d31;--ink:#e5ecf8;--muted:#8d9bb7;--line:#24324f;--crit:#f87171;--high:#fb7185;--med:#fbbf24;--low:#7aa7ff;--info:#94a3b8;--ok:#4ade80}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 "Segoe UI",system-ui,sans-serif}
header{background:linear-gradient(120deg,#0a1a33,#0f3b5f);color:#fff;padding:28px 24px}header h1{margin:0;font-size:26px}header p{margin:4px 0 0;color:#c6d3ea}
main{max-width:1200px;margin:auto;padding:20px 16px 60px}
.top{display:grid;grid-template-columns:minmax(220px,300px) 1fr;gap:16px}@media(max-width:760px){.top{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.score{text-align:center}.score b{display:block;font-size:56px;line-height:1}.score .g{color:var(--ok)}.score .m{color:var(--med)}.score .b{color:var(--high)}
.areas{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.area{border:1px solid var(--line);border-radius:12px;padding:10px 12px}.area b{display:block}.area small{color:var(--muted)}
h2{font-size:19px;margin:28px 0 10px}h3{font-size:15px;margin:18px 0 8px;color:var(--muted)}
.f{display:grid;grid-template-columns:96px 1fr;gap:12px;background:var(--card);border:1px solid var(--line);border-left:5px solid var(--c);border-radius:12px;padding:10px 14px;margin-bottom:8px}
.f .sev{font-weight:700;color:var(--c);font-size:13px;text-transform:uppercase}.f b{display:block}.f .d{color:var(--muted);font-size:13.5px;word-break:break-word}.f .x{font-size:13.5px;margin-top:4px}
.Critical{--c:var(--crit)}.High{--c:var(--high)}.Medium{--c:var(--med)}.Low{--c:var(--low)}.Info{--c:var(--info)}
.tw{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:12px}
table{border-collapse:collapse;width:100%;font-size:13.5px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-word}
th{background:color-mix(in srgb,var(--line) 45%,var(--card));font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted)}
details{margin-top:10px}summary{cursor:pointer;font-weight:600;font-size:17px;padding:8px 0}
.ok{color:var(--ok);font-weight:600}
</style></head><body>
<header><h1>Security Report</h1><p>$(Enc $env:COMPUTERNAME) &middot; $(Get-Date -Format 'dddd d MMMM yyyy, HH:mm') &middot; $(if ($IsAdmin) { 'full check (administrator)' } else { 'limited check (not administrator)' })</p></header>
<main><div class="top"><div class="card score"><small>Security score</small><b class="$gradeCls">$score</b><div class="$gradeCls" style="font-weight:600">$grade</div></div>
<div class="card"><div class="areas">
"@)
  foreach ($a in $areas) {
    $fs = @($Findings | Where-Object { $_.Area -eq $a -and $_.Severity -ne 'Info' })
    $worst = ($fs | Sort-Object @{ e = { $order[$_.Severity] } } | Select-Object -First 1).Severity
    $cls = ''; if ($worst) { $cls = $worst }
    $txt = 'No issues found'; if ($fs.Count) { $txt = "$($fs.Count) issue(s), worst: $worst" }
    $null = $sb.Append('<div class="area ' + $cls + '" style="border-left:5px solid var(--c,var(--ok))"><b>' + (Enc $a) + '</b><small>' + $txt + '</small></div>')
  }
  $null = $sb.Append('</div></div></div><h2>What to fix</h2>')
  if (-not $sorted) { $null = $sb.Append('<div class="card ok">No problems found. Keep Windows and your antivirus up to date.</div>') }
  foreach ($f in $sorted) {
    $d = ''; if ($f.Detail) { $d = '<div class="d">' + (Enc $f.Detail) + '</div>' }
    $x = ''; if ($f.Fix) { $x = '<div class="x"><b style="display:inline">Fix:</b> ' + (Enc $f.Fix) + '</div>' }
    $null = $sb.Append('<div class="f ' + $f.Severity + '"><div><div class="sev">' + $f.Severity + '</div><small>' + (Enc $f.Area) + '</small></div><div><b>' + (Enc $f.Title) + '</b>' + $d + $x + '</div></div>')
  }
  $null = $sb.Append('<h2>Details</h2>')
  foreach ($a in $Details.Keys) {
    $null = $sb.Append("<details open><summary>$(Enc $a)</summary>")
    foreach ($t in $Details[$a]) {
      $null = $sb.Append("<h3>$(Enc $t.Heading)</h3>")
      if (-not $t.Rows.Count) { $null = $sb.Append('<div class="card">Nothing found.</div>'); continue }
      $null = $sb.Append('<div class="tw"><table><thead><tr>')
      foreach ($c in $t.Columns) { $null = $sb.Append("<th>$(Enc $c)</th>") }
      $null = $sb.Append('</tr></thead><tbody>')
      foreach ($r in $t.Rows) {
        $null = $sb.Append('<tr>')
        foreach ($c in $t.Columns) { $null = $sb.Append("<td>$(Enc $r.$c)</td>") }
        $null = $sb.Append('</tr>')
      }
      $null = $sb.Append('</tbody></table></div>')
    }
    $null = $sb.Append('</details>')
  }
  $null = $sb.Append('<p style="color:var(--muted);font-size:12.5px;margin-top:30px">This tool reads settings and logs; it does not change anything on your computer. Run it again any time to see if fixes worked.</p></main></body></html>')

  $file = Join-Path $ReportDir ("SecurityReport-" + (Get-Date -Format 'yyyy-MM-dd_HHmm') + '.html')
  [IO.File]::WriteAllText($file, $sb.ToString(), [Text.Encoding]::UTF8)
  Copy-Item $file (Join-Path $Root 'Latest Security Report.html') -Force
  return [pscustomobject]@{ File = $file; Score = $score; Grade = $grade }
}

# ---------------------------------------------------------------- Watch mode
function Get-Snapshot {
  $lan = Get-Lan
  $w = Get-WifiNow
  $snap = [ordered]@{
    Ports   = @(Get-ListeningPorts | Where-Object { $_.'Open to network' -eq 'Yes' } | ForEach-Object { "$($_.Proto)/$($_.Port) ($($_.Program))" } | Sort-Object -Unique)
    Devices = @(); Gateway = ''; Wifi = ''; WifiAuth = ''
    Threats = @(Get-MpThreat | Where-Object { $_.IsActive } | ForEach-Object { $_.ThreatName })
    Fails   = 0; Rdp = @()
  }
  if ($lan) {
    $d = @(Get-LanDevices $lan)
    $snap.Devices = @($d | ForEach-Object { $_.MAC } | Sort-Object -Unique)
    $snap.Gateway = ($d | Where-Object { $_.IP -eq $lan.Gateway } | Select-Object -First 1).MAC
    $snap.DeviceIp = @{}; foreach ($x in $d) { $snap.DeviceIp[$x.MAC] = $x.IP }
  }
  if ($w) { $snap.Wifi = $w.SSID; $snap.WifiAuth = $w.Auth }
  if ($IsAdmin) {
    $since = (Get-Date).AddMinutes( - $IntervalMinutes)
    $snap.Fails = @(Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4625; StartTime = $since } -MaxEvents 1000).Count
    $snap.Rdp = @(Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4624; StartTime = $since } -MaxEvents 500 | Where-Object { [int]$_.Properties[8].Value -eq 10 } | ForEach-Object { "$($_.Properties[5].Value) from $($_.Properties[18].Value)" })
  }
  return $snap
}
function Start-Watch {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $icon = New-Object System.Windows.Forms.NotifyIcon
  $icon.Icon = [System.Drawing.SystemIcons]::Shield
  $icon.Text = 'Security Monitor is watching'
  $icon.Visible = $true
  $log = Join-Path $DataDir 'watch-log.txt'
  function Alert($title, $msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $title - $msg"
    Write-Host $line -ForegroundColor Yellow
    Add-Content -Path $log -Value $line
    $icon.ShowBalloonTip(15000, $title, $msg, [System.Windows.Forms.ToolTipIcon]::Warning)
    [System.Media.SystemSounds]::Exclamation.Play()
  }
  Write-Host "`n  Watching every $IntervalMinutes minute(s). Alerts appear in the corner of the screen and in data\watch-log.txt." -ForegroundColor Green
  Write-Host "  Leave this window open (you can minimise it). Close it to stop.`n" -ForegroundColor Green
  $prev = Get-Snapshot
  $icon.ShowBalloonTip(5000, 'Security Monitor', "Watching ports, devices, Wi-Fi, sign-ins and viruses every $IntervalMinutes min.", [System.Windows.Forms.ToolTipIcon]::Info)
  try {
    while ($true) {
      Start-Sleep -Seconds ($IntervalMinutes * 60)
      $now = Get-Snapshot
      foreach ($p in $now.Ports | Where-Object { $prev.Ports -notcontains $_ }) { Alert 'New open port' "A program opened $p to the network." }
      foreach ($m in $now.Devices | Where-Object { $prev.Devices -notcontains $_ }) { Alert 'New device on your network' "$($now.DeviceIp[$m]) ($m) just joined." }
      if ($prev.Gateway -and $now.Gateway -and $prev.Gateway -ne $now.Gateway -and $prev.Wifi -eq $now.Wifi) { Alert 'Router address changed' "Router MAC changed from $($prev.Gateway) to $($now.Gateway). Possible interception." }
      if ($now.Wifi -and $now.Wifi -ne $prev.Wifi) { Alert 'Wi-Fi changed' "Now connected to '$($now.Wifi)' ($($now.WifiAuth))." }
      if ($now.WifiAuth -match 'Open' -and $now.Wifi -ne $prev.Wifi) { Alert 'Open Wi-Fi' "'$($now.Wifi)' has no password. Avoid sensitive logins." }
      foreach ($t in $now.Threats | Where-Object { $prev.Threats -notcontains $_ }) { Alert 'Virus detected' "Defender found $t. Open Windows Security > Protection history." }
      if ($now.Fails -ge 5) { Alert 'Password guessing' "$($now.Fails) failed sign-ins in the last $IntervalMinutes minutes." }
      foreach ($r in $now.Rdp) { Alert 'Remote Desktop sign-in' $r }
      $prev = $now
      Write-Host "  $(Get-Date -Format 'HH:mm')  checked - $($now.Ports.Count) open ports, $($now.Devices.Count) devices on network" -ForegroundColor DarkGray
    }
  }
  finally { $icon.Visible = $false; $icon.Dispose() }
}

# ---------------------------------------------------------------- Main
Write-Host "`n  SECURITY MONITOR - $env:COMPUTERNAME" -ForegroundColor White
if (-not $IsAdmin) { Write-Host '  (Not running as administrator: some checks are limited.)' -ForegroundColor Yellow }

if ($Watch) { Start-Watch; return }

Check-Antivirus
Check-Malware
Check-Intruders
Check-Ports
Check-Vulnerabilities
Check-Wifi
$r = Write-Report
$c = @($Findings | Where-Object { $_.Severity -in 'Critical', 'High' }).Count
Write-Host "`n  Score: $($r.Score)/100 - $($r.Grade). $c serious issue(s)." -ForegroundColor $(if ($r.Score -ge 85) { 'Green' } elseif ($r.Score -ge 60) { 'Yellow' } else { 'Red' })
Write-Host "  Report: $($r.File)`n"
if (-not $NoOpen) { Start-Process $r.File }
