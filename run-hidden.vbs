Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """%LOCALAPPDATA%\MovieLibrary\movielibrary-helper-win-x64.exe""", 0, False
' The "0" hides the window, "False" runs it non-blocking