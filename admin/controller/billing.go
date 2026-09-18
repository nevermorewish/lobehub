package controller

import (
	"github.com/gin-gonic/gin"
	"lobehub/admin/service"
)

func (h *Controller) BillingWallets(c *gin.Context) {
	p, n, ok := pagination(c)
	if !ok {
		return
	}
	d, e := h.Service.BillingWallets(c.Request.Context(), c.Query("search"), p, n)
	respond(c, d, e)
}
func (h *Controller) BillingOrders(c *gin.Context) {
	p, n, ok := pagination(c)
	if !ok {
		return
	}
	d, e := h.Service.BillingOrders(c.Request.Context(), c.Query("search"), p, n)
	respond(c, d, e)
}
func (h *Controller) BillingLedger(c *gin.Context) {
	p, n, ok := pagination(c)
	if !ok {
		return
	}
	d, e := h.Service.BillingLedger(c.Request.Context(), c.Query("account"), p, n)
	respond(c, d, e)
}
func (h *Controller) AdjustWallet(c *gin.Context) {
	var input service.AdjustmentInput
	if !bind(c, &input) {
		return
	}
	d, e := h.Service.AdjustWallet(c.Request.Context(), c.GetString("actor"), c.Param("id"), input)
	respond(c, d, e)
}
func (h *Controller) CreditPacks(c *gin.Context) {
	d, e := h.Service.CreditPacks(c.Request.Context())
	respond(c, d, e)
}
func (h *Controller) SaveCreditPack(c *gin.Context) {
	var input service.CreditPackInput
	if !bind(c, &input) {
		return
	}
	e := h.Service.SaveCreditPack(c.Request.Context(), c.GetString("actor"), input)
	respond(c, gin.H{"slug": input.Slug}, e)
}
