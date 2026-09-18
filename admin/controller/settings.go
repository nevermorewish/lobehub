package controller

import (
	"github.com/gin-gonic/gin"
	"lobehub/admin/service"
)

func (h *Controller) Settings(c *gin.Context) {
	data, err := h.Service.Settings(c.Request.Context(), c.Param("section"))
	respond(c, data, err)
}

func (h *Controller) SaveSettings(c *gin.Context) {
	var input service.SettingsInput
	if !bind(c, &input) {
		return
	}
	data, err := h.Service.SaveSettings(c.Request.Context(), c.GetString("actor"), c.Param("section"), input)
	respond(c, data, err)
}

func (h *Controller) RuntimeSettings(c *gin.Context) {
	data, err := h.Service.RuntimeSettings(c.Request.Context())
	respond(c, data, err)
}
