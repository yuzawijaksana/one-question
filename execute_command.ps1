param (
    [Parameter(Mandatory=$true)]
    [string]$command
)

$commandObject = ConvertFrom-Json -InputObject $command

switch ($commandObject.name) {
    "grep_search" {
        $query = $commandObject.arguments.query
        # Call the grep_search tool here
        # For example:
        # grep_search $query
    }
    default {
        Write-Error "Unknown command: $($commandObject.name)"
    }
}