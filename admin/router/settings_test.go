package router

import (
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"lobehub/admin/common"
	"lobehub/admin/service"
)

func TestMenuDeepLinksAndProtectedRuntime(t *testing.T) {
	s := &service.Service{Config: common.Config{IntegrationToken: strings.Repeat("t", 40)}}
	r := New(s, fstest.MapFS{"index.html": {Data: []byte("<html>admin</html>")}})
	for _, path := range []string{"/users", "/wallets", "/orders", "/ledger", "/packs", "/conversations", "/knowledge", "/providers", "/prices", "/payments", "/audit", "/storage", "/settings"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 200 || !strings.Contains(w.Body.String(), "<html>admin</html>") {
			t.Fatalf("deep link %s: %d", path, w.Code)
		}
	}
	for _, path := range []string{"/api/admin/settings/storage", "/api/admin/settings/system", "/internal/v1/settings"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 401 {
			t.Fatalf("unprotected settings %s: %d", path, w.Code)
		}
		if w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("settings must not be cached")
		}
	}
}
