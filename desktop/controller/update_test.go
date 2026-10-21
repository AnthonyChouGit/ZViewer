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
		`C:\Apps\ZViewer`, `C:\Apps\ZViewer\ZViewerDesktop.exe`, 4321)
	for _, want := range []string{
		"$procId = 4321",
		"Get-Process -Id $procId",
		"Expand-Archive",
		"Copy-Item",
		"$installed = Get-ChildItem",
		"remove stale entry",
		"Start-Process -FilePath $next",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("script missing %q", want)
		}
	}
	if !strings.Contains(script, `'C:\Users\Zero\AppData\Roaming\ZViewer\updates\0.4.2\zviewer-windows-x64-GUI.zip'`) {
		t.Fatal("path should be single quoted")
	}
}

func TestIsShellEntry(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"zviewer-windows-x64-GUI/ZViewerDesktop.exe", true},
		{"zviewer-windows-x64-GUI/ZViewerShell.exe", true},
		{"zviewer-windows-x64-GUI/runtime/zviewer-backend.exe", false},
		{"zviewer-windows-x64-GUI/README.md", false},
	}
	for _, item := range cases {
		if got := isShellEntry(item.name); got != item.want {
			t.Fatalf("isShellEntry(%q)=%v, want %v", item.name, got, item.want)
		}
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

func TestNormalizeUpdateProxy(t *testing.T) {
	cases := []struct {
		in    string
		want  string
		fails bool
	}{
		{"", "", false},
		{DefaultUpdateProxy, DefaultUpdateProxy, false},
		{"  https://gh-proxy.com/  ", "https://gh-proxy.com", false},
		{"https://ghproxy.net/gh", "https://ghproxy.net/gh", false},
		{"http://gh-proxy.com", "", true},
		{"gh-proxy.com", "", true},
		{"https://gh-proxy.com/?a=1", "", true},
	}
	for _, item := range cases {
		got, err := NormalizeUpdateProxy(item.in)
		if (err != nil) != item.fails || got != item.want {
			t.Fatalf("NormalizeUpdateProxy(%q)=(%q,%v), want (%q, fails=%v)", item.in, got, err, item.want, item.fails)
		}
	}
}

func TestDownloadCandidates(t *testing.T) {
	asset := releaseAsset{ID: 659024627, Name: "zviewer-windows-x64-GUI.zip", URL: "https://github.com/o/r/releases/download/v1/zviewer-windows-x64-GUI.zip"}
	first, fallback := downloadCandidates(asset, DefaultUpdateProxy)
	if first != DefaultUpdateProxy+"/"+asset.URL {
		t.Fatalf("proxy url = %q", first)
	}
	if fallback != "https://api.github.com/repos/Zero-wyc/ZViewer/releases/assets/659024627" {
		t.Fatalf("fallback = %q", fallback)
	}
	first, fallback = downloadCandidates(asset, "")
	if first != "https://api.github.com/repos/Zero-wyc/ZViewer/releases/assets/659024627" || fallback != "" {
		t.Fatalf("direct candidates = %q / %q", first, fallback)
	}
}

func TestAllowedUpdateHost(t *testing.T) {
	allow := []string{"gh-proxy.com"}
	for _, host := range []string{"github.com", "api.github.com", "gh-proxy.com", "GH-PROXY.COM"} {
		if !allowedUpdateHost(host, allow) {
			t.Fatalf("%s should be allowed", host)
		}
	}
	for _, host := range []string{"evil.example", "", "ghproxy.net"} {
		if allowedUpdateHost(host, allow) {
			t.Fatalf("%s should be rejected", host)
		}
	}
	if publicHost("127.0.0.1") || publicHost("localhost") || publicHost("192.168.1.2") || publicHost("::1") {
		t.Fatal("internal hosts must not pass publicHost")
	}
	if !publicHost("gh-proxy.com") || !publicHost("8.8.8.8") {
		t.Fatal("public hosts should pass")
	}
}
