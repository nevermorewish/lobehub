package controller

import (
	"crypto/subtle"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

const sessionCookie = "lobehub_admin_session"

func (h *Controller) cookie(c *gin.Context, value string, maxAge int) {
	c.SetSameSite(http.SameSiteStrictMode)
	c.SetCookie(sessionCookie, value, maxAge, "/", "", strings.HasPrefix(h.Service.Config.Origin, "https://"), true)
}
func (h *Controller) Login(c *gin.Context) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !bind(c, &input) {
		return
	}
	token, err := h.Service.Login(c.Request.Context(), input.Username, input.Password)
	if err != nil {
		respond(c, nil, err)
		return
	}
	h.cookie(c, token, 12*60*60)
	OK(c, gin.H{"username": input.Username})
}
func (h *Controller) Logout(c *gin.Context) {
	token, _ := c.Cookie(sessionCookie)
	if err := h.Service.Logout(c.Request.Context(), token); err != nil {
		respond(c, nil, err)
		return
	}
	h.cookie(c, "", -1)
	OK(c, nil)
}
func (h *Controller) RequireAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, _ := c.Cookie(sessionCookie)
		actor, err := h.Service.Authenticate(c.Request.Context(), token)
		if err != nil {
			respond(c, nil, err)
			c.Abort()
			return
		}
		c.Set("actor", actor)
		c.Next()
	}
}
func (h *Controller) RequireIntegration() gin.HandlerFunc {
	return func(c *gin.Context) {
		actual := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(actual), []byte(h.Service.Config.IntegrationToken)) != 1 {
			Fail(c, 401, "unauthorized", "Invalid integration credentials")
			return
		}
		c.Next()
	}
}
func (h *Controller) SameOrigin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Method != "GET" && c.Request.Method != "HEAD" && c.Request.Method != "OPTIONS" {
			if c.GetHeader("Origin") != h.Service.Config.Origin || c.GetHeader("X-Admin-Request") != "1" {
				Fail(c, 403, "forbidden", "Request origin is not allowed")
				return
			}
		}
		c.Next()
	}
}

// A bounded per-IP limiter. No forwarded headers are trusted by the router.
func LoginLimiter() gin.HandlerFunc {
	type attempt struct {
		count int
		until time.Time
	}
	var mu sync.Mutex
	entries := map[string]attempt{}
	return func(c *gin.Context) {
		mu.Lock()
		now := time.Now()
		for key, a := range entries {
			if now.After(a.until) {
				delete(entries, key)
			}
		}
		ip := c.ClientIP()
		a := entries[ip]
		if a.until.IsZero() {
			a.until = now.Add(time.Minute)
		}
		if a.count >= 10 || (len(entries) >= 10000 && a.count == 0) {
			mu.Unlock()
			c.Header("Retry-After", "60")
			Fail(c, 429, "rate_limited", "Too many login attempts. Retry in one minute.")
			return
		}
		a.count++
		entries[ip] = a
		mu.Unlock()
		c.Next()
	}
}
