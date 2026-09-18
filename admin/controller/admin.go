package controller

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"lobehub/admin/model"
	"lobehub/admin/service"
)

type Controller struct{ Service *service.Service }

func OK(c *gin.Context, data any) { c.JSON(http.StatusOK, gin.H{"success": true, "data": data}) }
func Fail(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{"success": false, "code": code, "message": message})
}

func respond(c *gin.Context, data any, err error) {
	if err == nil {
		OK(c, data)
		return
	}
	switch {
	case errors.Is(err, service.ErrLastAdmin):
		Fail(c, 400, "last_admin", "The last active administrator cannot be deleted")
	case errors.Is(err, gorm.ErrRecordNotFound):
		Fail(c, 404, "not_found", "Record not found")
	case errors.Is(err, service.ErrConflict), errors.Is(err, gorm.ErrDuplicatedKey):
		Fail(c, 409, "conflict", "Record changed or already exists; reload and try again")
	case errors.Is(err, service.ErrUnauthorized):
		Fail(c, 401, "unauthorized", "Invalid username or password")
	case errors.Is(err, service.ErrInsufficientCredits):
		Fail(c, 400, "insufficient_credits", "Adjustment exceeds available credits")
	case errors.Is(err, service.ErrInvalid):
		Fail(c, 400, "invalid_input", "Check the form fields and try again")
	default:
		// Database and cryptographic errors must not expose connection strings or secrets.
		log.Printf("request failed: %s %s (%T)", c.Request.Method, c.FullPath(), err)
		Fail(c, 500, "operation_failed", "Unable to save or load this record. Check required fields and configuration, then retry.")
	}
}

func bind(c *gin.Context, target any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		Fail(c, 400, "invalid_input", "Invalid request body")
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		Fail(c, 400, "invalid_input", "Only one JSON value is allowed")
		return false
	}
	return true
}
func pagination(c *gin.Context) (int, int, bool) {
	p, e := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, e2 := strconv.Atoi(c.DefaultQuery("pageSize", "25"))
	if e != nil || e2 != nil || p < 1 || p > 1000000 || size < 1 || size > 100 {
		Fail(c, 400, "invalid_input", "Invalid pagination")
		return 0, 0, false
	}
	return p, size, true
}

func (h *Controller) Users(c *gin.Context) {
	p, n, ok := pagination(c)
	if !ok {
		return
	}
	data, err := h.Service.Users(c.Request.Context(), c.Query("search"), c.Query("status"), p, n)
	respond(c, data, err)
}
func (h *Controller) UpdateUser(c *gin.Context) {
	var input service.UserUpdate
	if !bind(c, &input) {
		return
	}
	data, err := h.Service.UpdateUser(c.Request.Context(), c.GetString("actor"), c.Param("id"), input)
	respond(c, data, err)
}
func (h *Controller) Providers(c *gin.Context) {
	data, err := h.Service.Providers(c.Request.Context())
	respond(c, data, err)
}
func (h *Controller) DeleteUser(c *gin.Context) {
	var input struct {
		UpdatedAt time.Time `json:"updatedAt"`
	}
	if !bind(c, &input) {
		return
	}
	respond(c, nil, h.Service.DeleteUser(c.Request.Context(), c.GetString("actor"), c.Param("id"), input.UpdatedAt))
}
func (h *Controller) RevokeUserSessions(c *gin.Context) {
	respond(c, nil, h.Service.RevokeUserSessions(c.Request.Context(), c.GetString("actor"), c.Param("id")))
}
func (h *Controller) UserWallet(c *gin.Context) {
	data, err := h.Service.UserWallet(c.Request.Context(), c.GetString("actor"), c.Param("id"))
	respond(c, data, err)
}
func (h *Controller) SaveProvider(c *gin.Context) {
	var input service.ProviderInput
	if !bind(c, &input) {
		return
	}
	data, err := h.Service.SaveProvider(c.Request.Context(), c.GetString("actor"), c.Param("id"), input)
	respond(c, data, err)
}
func (h *Controller) Prices(c *gin.Context) {
	p, n, ok := pagination(c)
	if !ok {
		return
	}
	data, err := h.Service.Prices(c.Request.Context(), c.Query("search"), c.Query("archived") == "true", p, n)
	respond(c, data, err)
}
func (h *Controller) SavePrice(c *gin.Context) {
	var input model.Price
	if !bind(c, &input) {
		return
	}
	data, err := h.Service.SavePrice(c.Request.Context(), c.GetString("actor"), input)
	respond(c, data, err)
}
func (h *Controller) ArchivePrice(c *gin.Context) {
	err := h.Service.ArchivePrice(c.Request.Context(), c.GetString("actor"), c.Param("id"))
	respond(c, gin.H{"id": c.Param("id")}, err)
}
func (h *Controller) Payments(c *gin.Context) {
	data, err := h.Service.Payments(c.Request.Context())
	respond(c, data, err)
}
func (h *Controller) SavePayment(c *gin.Context) {
	var input service.PaymentInput
	if !bind(c, &input) {
		return
	}
	data, err := h.Service.SavePayment(c.Request.Context(), c.GetString("actor"), c.Param("id"), input)
	respond(c, data, err)
}
func (h *Controller) Catalog(c *gin.Context) {
	data, err := h.Service.Catalog(c.Request.Context())
	respond(c, data, err)
}
func (h *Controller) RuntimeProvider(c *gin.Context) {
	data, err := h.Service.RuntimeProvider(c.Request.Context(), c.Param("id"))
	respond(c, data, err)
}
func (h *Controller) RuntimePayment(c *gin.Context) {
	data, err := h.Service.RuntimePayment(c.Request.Context(), c.Param("id"))
	respond(c, data, err)
}
func (h *Controller) Audit(c *gin.Context) {
	p, n, ok := pagination(c)
	if !ok {
		return
	}
	data := model.Page[model.Audit]{Items: []model.Audit{}, Page: p, PageSize: n}
	q := h.Service.DB.WithContext(c.Request.Context()).Model(&model.Audit{})
	if err := q.Count(&data.Total).Error; err != nil {
		respond(c, nil, err)
		return
	}
	err := q.Order("id DESC").Limit(n).Offset((p - 1) * n).Find(&data.Items).Error
	respond(c, data, err)
}

func (h *Controller) Health(c *gin.Context) {
	db, err := h.Service.DB.DB()
	if err == nil {
		err = db.PingContext(c.Request.Context())
	}
	if err != nil {
		Fail(c, 503, "unavailable", "Database unavailable")
		return
	}
	OK(c, gin.H{"status": "ok"})
}
