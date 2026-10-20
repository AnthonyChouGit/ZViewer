package controller

import (
	"strings"
	"testing"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.4.2", "0.4.1", 1},
		{"v0.4.1", "0.4.1", 0},
		{"0.4.1", "0.4.10", -1},
		{"0.10.0", "0.9.9", 1},
		{"1.0", "1.0.0", 0},
		{"0.4.1-beta", "0.4.1", 0},
		{"", "0.1.0", -1},
	}
	for _, item := range cases {
		if got := compareVersions(item.a, item.b); got != item.want {
			t.Fatalf("compareVersions(%q,%q)=%d, want %d", item.a, item.b, got, item.want)
		}
	}
}

func TestPickUpdateAsset(t *testing.T) {
	assets := []releaseAsset{
		{Name: "zviewer-windows-x64.zip", Size: 1},
		{Name: "SHA256SUMS.txt", Size: 1},
		{Name: "zviewer-windows-x64-GUI.zip", Size: 2048},
	}
	asset, ok := pickUpdateAsset(assets)
	if !ok || asset.Name != "zviewer-windows-x64-GUI.zip" || asset.Size != 2048 {
		t.Fatalf("unexpected asset: %+v ok=%v", asset, ok)
	}
	if _, ok := pickUpdateAsset(assets[:2]); ok {
		t.Fatal("should not pick a non-GUI package")
	}
}

func TestApplyScriptWaitsForExit(t *testing.T) {
	script := applyScript(`C:\Users\Zero\AppData\Roaming\ZViewer\updates\0.4.2\zviewer-windows-x64-GUI.zip`,
		`C:\Apps\ZViewer`, `C:\Apps\ZViewer\ZViewerShell.exe`, 4321)
	for _, want := range []string{
		"$procId = 4321",
		"Get-Process -Id $procId",
		"Expand-Archive",
		"Copy-Item",
		"Start-Process -FilePath $exe",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("script missing %q", want)
		}
	}
	if !strings.Contains(script, `'C:\Users\Zero\AppData\Roaming\ZViewer\updates\0.4.2\zviewer-windows-x64-GUI.zip'`) {
		t.Fatal("path should be single quoted")
	}
}

func TestVersionParts(t *testing.T) {
	if parts := versionParts("v0.4.1"); len(parts) != 3 || parts[0] != 0 || parts[2] != 1 {
		t.Fatalf("unexpected parts: %v", parts)
	}
	if parts := versionParts("2.1.0+build7"); len(parts) != 3 || parts[1] != 1 {
		t.Fatalf("unexpected parts: %v", parts)
	}
}
