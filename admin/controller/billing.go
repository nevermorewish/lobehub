package controller

import (
	"time"

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
	filter := service.LedgerFilter{Account: c.Query("account"), User: c.Query("user"), Search: c.Query("search"), Model: c.Query("model"), Provider: c.Query("provider"), Kind: c.Query("kind")}
	for key, target := range map[string]**time.Time{"from": &filter.From, "to": &filter.To} {
		if value := c.Query(key); value != "" {
			parsed, err := time.Parse(time.RFC3339, value)
			if err != nil {
				respond(c, nil, service.ErrInvalid)
				return
			}
			*target = &parsed
		}
	}
	if filter.From != nil && filter.To != nil && filter.From.After(*filter.To) {
		respond(c, nil, service.ErrInvalid)
		return
	}
	d, e := h.Service.FilteredBillingLedger(c.Request.Context(), filter, p, n)
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
