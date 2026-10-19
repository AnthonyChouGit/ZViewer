package main

import (
	"fmt"
	"net/http"
	"strings"
)

// Desktop integration patch: media routes remain available to ZViewer pages,
// while Cookie-bearing settings routes accept only this CLI's local setup page.
// This wrapper must surround the CORS middleware, including its OPTIONS handler.
func desktopProtectCLISettings(next http.Handler, port int) http.Handler {
	loopbackHost := fmt.Sprintf("127.0.0.1:%d", port)
	localhostHost := fmt.Sprintf("localhost:%d", port)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/config", "/api/qr", "/api/qr/poll", "/api/connect", "/api/disconnect":
			// Host validation also applies to clients without Origin and prevents
			// a DNS-rebound hostname from reaching the local credential store.
			validHost := r.Host == loopbackHost || strings.EqualFold(r.Host, localhostHost)
			origin := r.Header.Get("Origin")
			validOrigin := origin == "" || origin == "http://"+loopbackHost || strings.EqualFold(origin, "http://"+localhostHost)
			// Browsers omit an explicit :80 in HTTP Host and Origin values.
			if port == 80 {
				validHost = validHost || r.Host == "127.0.0.1" || strings.EqualFold(r.Host, "localhost")
				validOrigin = validOrigin || origin == "http://127.0.0.1" || strings.EqualFold(origin, "http://localhost")
			}
			if !validHost || !validOrigin || len(r.Header.Values("Origin")) > 1 {
				http.Error(w, "Local CLI settings origin is not permitted", http.StatusForbidden)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
