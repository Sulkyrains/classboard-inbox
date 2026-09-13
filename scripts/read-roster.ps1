param([Parameter(Mandatory=$true)][string]$Workbook)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$book = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Workbook))
function Read-Entry($name) {
  $reader = [IO.StreamReader]::new($book.GetEntry($name).Open())
  try { return [xml]$reader.ReadToEnd() } finally { $reader.Dispose() }
}
try {
  $strings = Read-Entry 'xl/sharedStrings.xml'
  $sheet = Read-Entry 'xl/worksheets/sheet1.xml'
  $rows = foreach ($row in $sheet.worksheet.sheetData.row) {
    $cells = @($row.c)
    if ($cells.Count -ne 2) { throw 'Expected exactly two columns: name and student number' }
    $name = $strings.sst.si[[int]$cells[0].v].InnerText
    $number = [string]$cells[1].v
    [ordered]@{ name=$name; student_id=$number }
  }
  if (@($rows).Count -ne 29) { throw 'Expected 29 roster entries' }
  New-Item -ItemType Directory -Force -Path 'work' | Out-Null
  [IO.File]::WriteAllText((Join-Path (Get-Location) 'work/roster.json'),(ConvertTo-Json -InputObject @($rows)),[Text.UTF8Encoding]::new($false))
  Write-Output 'Roster extracted: 29 records. Personal data remains in ignored work directory.'
} finally { $book.Dispose() }
