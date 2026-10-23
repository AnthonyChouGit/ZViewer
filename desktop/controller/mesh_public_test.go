package controller

import (
	"net"
	"strconv"
	"testing"
)

func TestSplitMeshURIDefaultsPort(t *testing.T) {
	scheme, host, port, err := splitMeshURI("tcp://et.example.com")
	if err != nil {
		t.Fatalf("解析失败：%v", err)
	}
	if scheme != "tcp" || host != "et.example.com" || port != MeshDefaultPort {
		t.Fatalf("解析结果不对：%s %s %d", scheme, host, port)
	}
	if _, _, _, err := splitMeshURI("tcp://et.example.com:99999"); err == nil {
		t.Fatal("端口越界应当报错")
	}
	if _, _, _, err := splitMeshURI("http://et.example.com:11010"); err == nil {
		t.Fatal("不支持的协议应当报错")
	}
}

func TestProbeMeshPeerReportsClosedPort(t *testing.T) {
	// 先占一个端口再关掉，保证这个端口在本机一定没人监听。
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skip("无法申请本地端口：" + err.Error())
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()

	result := probeMeshPeer("tcp://127.0.0.1:" + strconv.Itoa(port))
	if result.State != "fail" {
		t.Fatalf("关闭的端口应当探测失败，实际 %s", result.State)
	}
	if result.Reason == "" {
		t.Fatal("失败时必须给出原因")
	}
}

func TestProbeMeshPeerAcceptsLiveListener(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Skip("无法申请本地端口：" + err.Error())
	}
	defer listener.Close()
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			_ = conn.Close()
		}
	}()

	port := listener.Addr().(*net.TCPAddr).Port
	result := probeMeshPeer("tcp://127.0.0.1:" + strconv.Itoa(port))
	if result.State != "ok" {
		t.Fatalf("本地监听应当探测成功，实际 %s（%s）", result.State, result.Reason)
	}
	if result.LatencyMs < 0 {
		t.Fatalf("延迟不应为负：%d", result.LatencyMs)
	}
}

func TestProbeMeshPeerMarksUDPUnknown(t *testing.T) {
	result := probeMeshPeer("udp://127.0.0.1:11010")
	if result.State != "unknown" {
		t.Fatalf("UDP 应当标记为未测试，实际 %s", result.State)
	}
}

func TestMeshPublicPeersIsCopy(t *testing.T) {
	list := MeshPublicPeers()
	if len(list) == 0 {
		t.Fatal("内置公共节点不应为空")
	}
	list[0] = "tcp://tampered:11010"
	if MeshPublicPeers()[0] == "tcp://tampered:11010" {
		t.Fatal("返回的应当是拷贝，不能改到内置列表")
	}
	for _, uri := range MeshPublicPeers() {
		scheme, _, _, err := splitMeshURI(uri)
		if err != nil {
			t.Fatalf("内置节点 %s 格式不合法：%v", uri, err)
		}
		if scheme != "tcp" {
			t.Fatalf("内置节点应统一用 tcp://（唯一能自动验证的协议），实际 %s", uri)
		}
	}
}
