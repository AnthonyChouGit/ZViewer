package main

import "testing"

// Wails 的 Windows 问询框只会返回 Yes / No / Cancel，历史上曾按自定义按钮
// 文案比较，导致点「是」也被当成取消（issue #25），这里锁住归一化行为。
func TestDialogConfirmed(t *testing.T) {
	cases := []struct {
		answer string
		want   bool
	}{
		{"Yes", true},
		{"yes", true},
		{" YES ", true},
		{"是", true},
		{"No", false},
		{"Cancel", false},
		{"", false},
		{"安装本机 CA 信任", false},
	}
	for _, item := range cases {
		if got := dialogConfirmed(item.answer); got != item.want {
			t.Fatalf("dialogConfirmed(%q)=%v, want %v", item.answer, got, item.want)
		}
	}
}
