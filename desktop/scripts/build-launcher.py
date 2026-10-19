"""Compile a small, icon-bearing entry point for an existing ZViewer GUI folder.

Example runtime bundle: python desktop/scripts/build-launcher.py --output ZViewer.exe
Example source workspace: add --gui-relative desktop/release/v0.4.1/ZViewer-win32-x64/ZViewer.exe --runtime-relative .
No files are embedded, extracted, installed or downloaded by this launcher.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PureWindowsPath
import re
import subprocess
import tempfile


def main() -> None:
    desktop = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='New launcher EXE path; an existing file is never overwritten')
    parser.add_argument('--gui-relative', default='app/ZViewer.exe', help='Fixed GUI executable path relative to the launcher directory')
    parser.add_argument('--runtime-relative', default='app/runtime', help='Existing runtime directory relative to the launcher directory; use . for its own directory')
    parser.add_argument('--state-relative', help='Optional default GUI state directory relative to the launcher; absent means the normal APPDATA profile')
    parser.add_argument('--version', default=json.loads((desktop / 'package.json').read_text(encoding='utf-8'))['version'])
    options = parser.parse_args()
    gui = options.gui_relative
    windows_gui = PureWindowsPath(gui)
    parts = re.split(r'[\\/]', gui)
    if (not gui or windows_gui.drive or windows_gui.root or ':' in gui or
            any(part in {'', '.', '..'} for part in parts) or
            windows_gui.name.lower() != 'zviewer.exe' or len(parts) < 2):
        raise SystemExit('GUI path must be a fixed child path ending in ZViewer.exe; absolute paths and traversal are not allowed')
    runtime = options.runtime_relative
    runtime_parts = re.split(r'[\\/]', runtime)
    windows_runtime = PureWindowsPath(runtime)
    if (not runtime or windows_runtime.drive or windows_runtime.root or ':' in runtime or
            (runtime != '.' and any(part in {'', '.', '..'} for part in runtime_parts))):
        raise SystemExit('Runtime directory must be . or a fixed child path; absolute paths and traversal are not allowed')
    state = options.state_relative
    state_value = None
    if state is not None:
        state_parts = re.split(r'[\\/]', state)
        windows_state = PureWindowsPath(state)
        if (not state or windows_state.drive or windows_state.root or ':' in state or
                (state != '.' and any(part in {'', '.', '..'} for part in state_parts))):
            raise SystemExit('Default state directory must be . or a fixed child path; absolute paths and traversal are not allowed')
        state_value = '/'.join(state_parts)
    if not re.fullmatch(r'\d+\.\d+\.\d+', options.version):
        raise SystemExit('Version must have the form major.minor.patch')
    if any(int(part) > 65534 for part in options.version.split('.')):
        raise SystemExit('Version components must not exceed 65534')
    output = options.output.resolve()
    if output.exists():
        raise SystemExit(f'Output already exists: {output}')
    compiler = Path(os.environ.get('WINDIR', r'C:\Windows')) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    if not compiler.is_file():
        raise SystemExit('Windows .NET Framework 4.x C# compiler not found')
    output.parent.mkdir(parents=True, exist_ok=True)
    artifacts = desktop / 'artifacts'
    artifacts.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='gui-launcher-build-', dir=artifacts) as scratch_name:
        scratch = Path(scratch_name)
        settings = scratch / 'LauncherBuild.cs'
        settings.write_text(
            'using System.Reflection;\n'
            '[assembly: AssemblyTitle("ZViewer")]\n'
            '[assembly: AssemblyDescription("Open the existing ZViewer desktop console")]\n'
            '[assembly: AssemblyCompany("ZViewer")]\n'
            '[assembly: AssemblyProduct("ZViewer Desktop")]\n'
            f'[assembly: AssemblyVersion("{options.version}.0")]\n'
            f'[assembly: AssemblyFileVersion("{options.version}.0")]\n'
            'internal static class LauncherBuild { internal const string GuiRelativePath = ' + json.dumps('/'.join(parts), ensure_ascii=True) +
            '; internal const string RuntimeRelativePath = ' + json.dumps('/'.join(runtime_parts), ensure_ascii=True) +
            '; internal const string DefaultStateRelativePath = ' + json.dumps(state_value, ensure_ascii=True) + '; }\n',
            encoding='utf-8')
        application_manifest = scratch / 'app.manifest'
        application_manifest.write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">'
            '<trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges>'
            '<requestedExecutionLevel level="asInvoker" uiAccess="false"/>'
            '</requestedPrivileges></security></trustInfo></assembly>', encoding='utf-8')
        subprocess.run([
            str(compiler), '/nologo', '/target:winexe', '/platform:x64', '/optimize+', '/debug-', '/codepage:65001',
            f'/out:{output}', f'/win32icon:{desktop / "assets/app.ico"}', f'/win32manifest:{application_manifest}',
            '/reference:System.Windows.Forms.dll',
            str(desktop / 'native/GuiLauncher.cs'), str(settings)
        ], check=True, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    print(json.dumps({'file': str(output), 'bytes': output.stat().st_size, 'version': options.version,
                      'guiRelativePath': '/'.join(parts), 'runtimeRelativePath': '/'.join(runtime_parts),
                      'stateRelativePath': state_value,
                      'extractsFiles': False, 'installsFiles': False}, indent=2))


if __name__ == '__main__':
    main()
