package router

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"lobehub/admin/controller"
	"lobehub/admin/service"
)

func New(s *service.Service, web fs.FS) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	_ = r.SetTrustedProxies(nil)
	r.Use(func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "no-referrer")
		if strings.HasPrefix(c.Request.URL.Path, "/api/") || strings.HasPrefix(c.Request.URL.Path, "/internal/") {
			c.Header("Cache-Control", "no-store")
		}
		c.Next()
	})
	h := &controller.Controller{Service: s}
	r.GET("/healthz", h.Health)
	api := r.Group("/api", h.SameOrigin())
	api.POST("/auth/login", controller.LoginLimiter(), h.Login)
	auth := api.Group("/auth", h.RequireAdmin())
	auth.GET("/me", func(c *gin.Context) { controller.OK(c, gin.H{"username": c.GetString("actor")}) })
	auth.POST("/logout", h.Logout)
	admin := api.Group("/admin", h.RequireAdmin())
	admin.GET("/users", h.Users)
	admin.PUT("/users/:id", h.UpdateUser)
	admin.GET("/providers", h.Providers)
	admin.PUT("/providers/:id", h.SaveProvider)
	admin.GET("/prices", h.Prices)
	admin.POST("/prices", h.SavePrice)
	admin.DELETE("/prices/:id", h.ArchivePrice)
	admin.GET("/payments", h.Payments)
	admin.PUT("/payments/:id", h.SavePayment)
	admin.GET("/audit", h.Audit)
	admin.GET("/conversations", h.Conversations)
	admin.GET("/conversations/:id/messages", h.Messages)
	admin.GET("/knowledge-bases", h.KnowledgeBases)
	admin.GET("/knowledge-bases/:id", h.KnowledgeBase)
	admin.PATCH("/knowledge-bases/:id", h.UpdateKnowledge)
	admin.GET("/knowledge-bases/:id/files", h.KnowledgeFiles)
	admin.GET("/knowledge-bases/:id/documents", h.KnowledgeDocuments)
	admin.GET("/knowledge-bases/:id/documents/:documentId", h.KnowledgeDocument)
	admin.GET("/knowledge-bases/:id/files/:fileId/chunks", h.KnowledgeChunks)
	internal := r.Group("/internal/v1", h.RequireIntegration())
	internal.GET("/catalog", h.Catalog)
	internal.GET("/providers/:id", h.RuntimeProvider)
	if web != nil {
		fileServer := http.FileServer(http.FS(web))
		r.NoRoute(func(c *gin.Context) {
			path := strings.TrimPrefix(c.Request.URL.Path, "/")
			if strings.HasPrefix(path, "api/") || strings.HasPrefix(path, "internal/") || (c.Request.Method != "GET" && c.Request.Method != "HEAD") {
				c.Status(404)
				return
			}
			if path != "" {
				if stat, err := fs.Stat(web, path); err == nil && !stat.IsDir() {
					fileServer.ServeHTTP(c.Writer, c.Request)
					return
				}
			}
			if strings.Contains(path, ".") {
				c.Status(404)
				return
			}
			index, err := fs.ReadFile(web, "index.html")
			if err != nil {
				c.Status(503)
				return
			}
			c.Header("Cache-Control", "no-cache")
			c.Data(200, "text/html; charset=utf-8", index)
		})
	}
	return r
}
