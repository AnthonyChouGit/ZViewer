package controller

// 软件更新：从 GitHub Release 取最新正式版，下载 GUI 运行包，再交给外部脚本在进程退出后替换文件。
// 关键约束：
//   1. 下载阶段不退出程序，界面可以继续使用；
//   2. 只有在包完整落盘并校验通过后，才允许执行安装；
//   3. 安装必须由独立进程完成，否则无法覆盖正在运行的 EXE。

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// updateRepo 是发布来源，与 CI 中的仓库保持一致。
const updateRepo = "Zero-wyc/ZViewer"

var (
	errNoRelease = errors.New("没有可用的正式版本")
	// 发布页里同时有命令行的 zviewer-windows-x64.zip，只认带 -GUI 后缀的运行包。
	updateAssetExp = regexp.MustCompile(`(?i)^zviewer-windows-[^/]*-gui\.zip$`)
	updateHostExp  = regexp.MustCompile(`(?i)^(github\.com|api\.github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)$`)
	updateTagExp   = regexp.MustCompile(`^v?\d+`)
)

// UpdateReport 是更新状态，直接进 Snapshot 供界面渲染。
type UpdateReport struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	State     string `json:"state"` // idle | checking | latest | available | downloading | ready | error
	Available bool   `json:"available"`
	Progress  int    `json:"progress"`
	Size      int64  `json:"size"`
	Asset     string `json:"asset"`
	PageURL   string `json:"pageUrl"`
	Notes     string `json:"notes"`
	CheckedAt string `json:"checkedAt"`
	Error     string `json:"error"`
	AutoCheck bool   `json:"autoCheck"`
	Path      string `json:"-"`
}

type releaseAsset struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Size int64  `json:"size"`
	URL  string `json:"browser_download_url"`
}

type releaseInfo struct {
	Tag        string         `json:"tag_name"`
	Name       string         `json:"name"`
	URL        string         `json:"html_url"`
	Prerelease bool           `json:"prerelease"`
	Draft      bool           `json:"draft"`
	Assets     []releaseAsset `json:"assets"`
}

// autoCheckEnabled 读取自动检查开关；未初始化配置时按开启处理。
func (c *Controller) autoCheckEnabled() bool {
	if c.store == nil {
		return true
	}
	return c.store.Value.AutoCheckUpdate
}

// UpdateReport 返回当前更新状态。
func (c *Controller) UpdateReport() UpdateReport {
	c.updateMu.Lock()
	defer c.updateMu.Unlock()
	if c.autoCheckEnabled() != c.update.AutoCheck {
		c.update.AutoCheck = c.autoCheckEnabled()
	}
	return c.update
}

// CheckUpdate 查询 GitHub 最新正式版；force 为 false 时复用 30 分钟内的结果。
func (c *Controller) CheckUpdate(force bool) UpdateReport {
	c.updateMu.Lock()
	if c.updateBusy || c.update.State == "downloading" {
		report := c.update
		c.updateMu.Unlock()
		return report
	}
	if !force && !c.updateAt.IsZero() && time.Since(c.updateAt) < 30*time.Minute && c.update.State != "idle" {
		report := c.update
		c.updateMu.Unlock()
		return report
	}
	c.updateBusy = true
	c.update.Current = c.version
	c.update.State = "checking"
	c.update.Error = ""
	c.updateMu.Unlock()
	c.emit()

	info, err := fetchLatestRelease(c.version)
	c.updateMu.Lock()
	c.updateBusy = false
	c.updateAt = time.Now()
	c.update.CheckedAt = time.Now().Format("2006-01-02 15:04")
	c.update.AutoCheck = c.autoCheckEnabled()
	switch {
	case errors.Is(err, errNoRelease):
		c.update.State, c.update.Available, c.update.Latest = "latest", false, ""
		c.update.Error = ""
	case err != nil:
		c.update.State, c.update.Available = "error", false
		c.update.Error = err.Error()
	default:
		c.update.Latest = strings.TrimPrefix(strings.TrimSpace(info.Tag), "v")
		c.update.PageURL = info.URL
		c.update.Notes = strings.TrimSpace(info.Name)
		c.update.Available = compareVersions(c.update.Latest, c.version) > 0
		if !c.update.Available {
			c.update.State, c.update.Error = "latest", ""
			break
		}
		asset, ok := pickUpdateAsset(info.Assets)
		if !ok {
			c.update.State, c.update.Available = "error", false
			c.update.Error = "最新版本没有附带 Windows 运行包"
			break
		}
		c.update.State = "available"
		c.update.Asset = asset.Name
		c.update.Size = asset.Size
		c.updateURL = assetDownloadURL(asset)
		c.updateSum = checksumURL(info.Assets)
		c.update.Progress = 0
	}
	report := c.update
	c.updateMu.Unlock()
	c.emit()
	return report
}

// StartUpdateDownload 在后台下载安装包；下载期间界面保持可用。
func (c *Controller) StartUpdateDownload() (UpdateReport, error) {
	report := c.UpdateReport()
	if report.State != "available" && report.State != "ready" {
		report = c.CheckUpdate(true)
	}
	if !report.Available {
		return report, errors.New("当前没有可下载的新版本")
	}
	if report.State == "ready" {
		return report, nil
	}
	c.updateMu.Lock()
	if c.updateBusy || c.update.State == "downloading" {
		report = c.update
		c.updateMu.Unlock()
		return report, nil
	}
	if c.updateURL == "" {
		c.updateMu.Unlock()
		return report, errors.New("缺少下载地址，请重新检查更新")
	}
	target := c.packagePath(c.update.Latest, c.update.Asset)
	c.updateBusy = true
	c.update.State = "downloading"
	c.update.Progress = 0
	c.update.Error = ""
	c.update.Path = target
	link, size, sum := c.updateURL, c.update.Size, c.updateSum
	report = c.update
	c.updateMu.Unlock()
	c.emit()

	go c.downloadUpdate(link, target, size, sum, c.update.Asset)
	return report, nil
}

// downloadUpdate 流式下载并校验，成功后才把状态推进到 ready。
func (c *Controller) downloadUpdate(link, target string, size int64, sum, asset string) {
	err := downloadFile(link, target, size, func(done, total int64) {
		progress := 0
		if total > 0 {
			progress = int(done * 100 / total)
			if progress > 99 && done < total {
				progress = 99
			}
		}
		c.updateMu.Lock()
		c.update.Progress = progress
		c.updateMu.Unlock()
		c.emit()
	})
	if err == nil {
		err = verifyUpdatePackage(target)
	}
	if err == nil {
		err = verifyChecksum(target, sum, asset)
	}
	c.updateMu.Lock()
	c.updateBusy = false
	if err == nil {
		c.update.State, c.update.Progress = "ready", 100
	} else {
		c.update.State = "error"
		c.update.Error = "下载失败：" + err.Error()
		_ = os.Remove(target)
	}
	c.updateMu.Unlock()
	if err == nil {
		c.Log("更新包已下载完成，等待重启安装", "update", "INFO")
	} else {
		c.Log(c.UpdateReport().Error, "update", "ERROR")
	}
	c.emit()
}

// PrepareUpdate 写好安装脚本：等待本进程退出，解压覆盖运行目录，再启动新版本。
// 脚本放在更新目录，避免安装过程中被自身覆盖。
func (c *Controller) PrepareUpdate(targetDir, exePath string, pid int) (string, error) {
	c.updateMu.Lock()
	ready := c.update.State == "ready"
	pkg := c.update.Path
	c.updateMu.Unlock()
	if !ready || pkg == "" || !fileExists(pkg) {
		return "", errors.New("更新包尚未下载完成")
	}
	if !fileExists(exePath) {
		return "", errors.New("找不到当前程序入口，无法自动更新")
	}
	dir := filepath.Dir(pkg)
	script := filepath.Join(dir, "apply-update.ps1")
	body := applyScript(pkg, targetDir, exePath, pid)
	if err := os.WriteFile(script, []byte(body), 0o600); err != nil {
		return "", fmt.Errorf("无法写入更新脚本：%w", err)
	}
	return script, nil
}

// applyScript 生成 PowerShell 安装脚本。路径统一用单引号包裹并转义，避免空格与中文目录出问题。
func applyScript(pkg, target, exe string, pid int) string {
	quote := func(text string) string { return "'" + strings.ReplaceAll(text, "'", "''") + "'" }
	stage := quote(filepath.Join(filepath.Dir(pkg), "staging"))
	return strings.Join([]string{
		"$ErrorActionPreference = 'Stop'",
		"$zip = " + quote(pkg),
		"$target = " + quote(target),
		"$exe = " + quote(exe),
		"$stage = " + stage,
		"$log = " + quote(filepath.Join(filepath.Dir(pkg), "apply.log")),
		fmt.Sprintf("$procId = %d", pid),
		"function Write-Log($text) { \"{0} {1}\" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $text | Out-File -FilePath $log -Append -Encoding utf8 }",
		"try {",
		"  Write-Log \"waiting for process $procId\"",
		"  $deadline = (Get-Date).AddSeconds(120)",
		"  while ((Get-Date) -lt $deadline) {",
		"    if (-not (Get-Process -Id $procId -ErrorAction SilentlyContinue)) { break }",
		"    Start-Sleep -Milliseconds 400",
		"  }",
		"  Start-Sleep -Milliseconds 1200",
		"  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }",
		"  Expand-Archive -Path $zip -DestinationPath $stage -Force",
		"  $src = Get-ChildItem -Path $stage -Directory | Select-Object -First 1",
		"  if (-not $src) { throw 'install package has no top directory' }",
		"  Copy-Item -Path (Join-Path $src.FullName '*') -Destination $target -Recurse -Force",
		"  Write-Log 'files replaced'",
		"  Start-Process -FilePath $exe -WorkingDirectory $target",
		"  Write-Log 'restarted'",
		"  Start-Sleep -Seconds 3",
		"  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue",
		"  Remove-Item $zip -Force -ErrorAction SilentlyContinue",
		"} catch {",
		"  Write-Log ('failed: ' + $_.Exception.Message)",
		"} finally {",
		"  Remove-Item $PSCommandPath -Force -ErrorAction SilentlyContinue",
		"}",
	}, "\r\n")
}

func (c *Controller) packagePath(tag, asset string) string {
	name := asset
	if name == "" {
		name = "zviewer-windows-x64-GUI.zip"
	}
	return filepath.Join(c.dir, "updates", tag, filepath.Base(name))
}

// fetchLatestRelease 取最新正式版；仓库只有预发布时会返回 errNoRelease。
func fetchLatestRelease(current string) (releaseInfo, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	endpoint := "https://api.github.com/repos/" + updateRepo + "/releases/latest"
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, endpoint, nil)
	if err != nil {
		return releaseInfo{}, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "ZViewerDesktop/"+current)
	response, err := client.Do(request)
	if err != nil {
		return releaseInfo{}, errors.New("无法连接 GitHub：" + err.Error())
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return releaseInfo{}, errNoRelease
	}
	if response.StatusCode != http.StatusOK {
		return releaseInfo{}, fmt.Errorf("GitHub 返回 %d", response.StatusCode)
	}
	var info releaseInfo
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&info); err != nil {
		return releaseInfo{}, errors.New("发布信息解析失败")
	}
	if info.Draft || info.Prerelease {
		return releaseInfo{}, errNoRelease
	}
	if !updateTagExp.MatchString(info.Tag) {
		return releaseInfo{}, errors.New("发布版本号无法识别")
	}
	return info, nil
}

// pickUpdateAsset 只认 GUI 运行包，避免误取后端压缩包。
func pickUpdateAsset(assets []releaseAsset) (releaseAsset, bool) {
	for _, asset := range assets {
		if updateAssetExp.MatchString(asset.Name) {
			return asset, true
		}
	}
	return releaseAsset{}, false
}

// assetDownloadURL 优先走 API 资产端点：国内直连 github.com 常超时，api.github.com 通常可达，
// 两者最终都重定向到对象存储。
func assetDownloadURL(asset releaseAsset) string {
	if asset.ID > 0 {
		return fmt.Sprintf("https://api.github.com/repos/%s/releases/assets/%d", updateRepo, asset.ID)
	}
	return asset.URL
}

// checksumURL 找到发布页附带的 SHA256SUMS.txt，拿不到时返回空串（跳过校验）。
func checksumURL(assets []releaseAsset) string {
	for _, asset := range assets {
		if strings.EqualFold(asset.Name, "SHA256SUMS.txt") {
			return assetDownloadURL(asset)
		}
	}
	return ""
}

// verifyChecksum 与发布页的 SHA256 比对；没有校验文件时放行，只有明确不一致才拦截。
func verifyChecksum(pkg, sumURL, name string) error {
	if sumURL == "" || name == "" {
		return nil
	}
	text, err := fetchText(sumURL)
	if err != nil {
		return nil
	}
	expected := ""
	for _, line := range strings.Split(text, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[1] == name {
			expected = strings.ToLower(fields[0])
			break
		}
	}
	if expected == "" {
		return nil
	}
	actual, err := fileSHA256(pkg)
	if err != nil {
		return err
	}
	if actual != expected {
		return errors.New("安装包校验值与发布页不一致")
	}
	return nil
}

func fetchText(link string) (string, error) {
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, link, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Accept", "application/octet-stream")
	request.Header.Set("User-Agent", "ZViewerDesktop")
	client := &http.Client{Timeout: 15 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("校验文件返回 %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func fileSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

// downloadFile 写入临时文件，完成后原子改名；回调用于进度。
func downloadFile(link, target string, size int64, onProgress func(done, total int64)) error {
	parsed, err := url.Parse(link)
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || !updateHostExp.MatchString(parsed.Hostname()) {
		return errors.New("下载地址不在允许的来源内")
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	client := &http.Client{Timeout: 30 * time.Minute}
	request, err := http.NewRequestWithContext(context.Background(), http.MethodGet, link, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/octet-stream")
	request.Header.Set("User-Agent", "ZViewerDesktop")
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("下载地址返回 %d", response.StatusCode)
	}
	// 跟随重定向后仍要确认最终来源，GitHub 会把包转到对象存储。
	if final := response.Request.URL; final == nil || !strings.EqualFold(final.Scheme, "https") || !updateHostExp.MatchString(final.Hostname()) {
		return errors.New("下载被重定向到未知来源")
	}
	total := response.ContentLength
	if total <= 0 {
		total = size
	}
	if total > 650<<20 {
		return errors.New("安装包超出预期大小")
	}
	part := target + ".part"
	file, err := os.OpenFile(part, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	writer := &progressWriter{dst: file, total: total, report: onProgress}
	written, copyErr := io.Copy(writer, io.LimitReader(response.Body, 650<<20))
	closeErr := file.Close()
	if copyErr != nil {
		_ = os.Remove(part)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(part)
		return closeErr
	}
	if size > 0 && written != size {
		_ = os.Remove(part)
		return fmt.Errorf("安装包大小不符（%d/%d 字节）", written, size)
	}
	if err := os.Rename(part, target); err != nil {
		_ = os.Remove(part)
		return err
	}
	return nil
}

// verifyUpdatePackage 只做结构校验：能打开、有内容、包含入口文件。
func verifyUpdatePackage(path string) error {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return errors.New("安装包不是有效的 ZIP")
	}
	defer reader.Close()
	found := false
	for _, entry := range reader.File {
		if strings.HasSuffix(strings.ToLower(entry.Name), "zviewershell.exe") {
			found = true
			break
		}
	}
	if !found || len(reader.File) == 0 {
		return errors.New("安装包里没有 ZViewerShell.exe")
	}
	return nil
}

type progressWriter struct {
	dst     io.Writer
	total   int64
	done    int64
	last    time.Time
	report  func(done, total int64)
	emitted bool
}

func (w *progressWriter) Write(p []byte) (int, error) {
	n, err := w.dst.Write(p)
	w.done += int64(n)
	if w.report != nil && (time.Since(w.last) > 300*time.Millisecond || !w.emitted) {
		w.last, w.emitted = time.Now(), true
		w.report(w.done, w.total)
	}
	return n, err
}

// compareVersions 比较语义化版本：a 大于 b 返回 1，相等 0，小于 -1。
func compareVersions(a, b string) int {
	left, right := versionParts(a), versionParts(b)
	for index := 0; index < len(left) || index < len(right); index++ {
		var x, y int
		if index < len(left) {
			x = left[index]
		}
		if index < len(right) {
			y = right[index]
		}
		if x != y {
			if x > y {
				return 1
			}
			return -1
		}
	}
	return 0
}

// versionParts 拆出数字段；"0.4.1-beta" 与 "0.4.1" 等同，预发布由 Release 的 prerelease 标记排除。
func versionParts(text string) []int {
	text = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(text), "v"))
	if index := strings.IndexAny(text, "-+"); index >= 0 {
		text = text[:index]
	}
	if text == "" {
		return nil
	}
	segments := strings.Split(text, ".")
	parts := make([]int, 0, len(segments))
	for _, segment := range segments {
		digits := segment
		if index := strings.IndexFunc(segment, func(r rune) bool { return r < '0' || r > '9' }); index >= 0 {
			digits = segment[:index]
		}
		value, err := strconv.Atoi(digits)
		if err != nil {
			value = 0
		}
		parts = append(parts, value)
	}
	return parts
}
