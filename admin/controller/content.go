package controller

import (
	"github.com/gin-gonic/gin"
	"lobehub/admin/service"
)

func (h *Controller) Conversations(c *gin.Context) {
	p, n, ok := pagination(c)
	if !ok {
		return
	}
	f := service.ConversationFilter{Search: c.Query("search"), Type: c.Query("type"), Status: c.Query("status"), Trigger: c.Query("trigger"), Model: c.Query("model"), Provider: c.Query("provider"), From: c.Query("from"), To: c.Query("to"), Sort: c.Query("sort"), Order: c.Query("order")}
	data, err := h.Service.Conversations(c.Request.Context(), f, p, n)
	respond(c, data, err)
}
func (h *Controller) Messages(c *gin.Context) {
	data, err := h.Service.Messages(c.Request.Context(), c.GetString("actor"), c.Param("id"), c.Query("cursor"))
	respond(c, data, err)
}
func (h *Controller) KnowledgeBases(c *gin.Context) {
	p, n, ok := pagination(c)
	if !ok {
		return
	}
	f := service.KnowledgeFilter{Search: c.Query("search"), Scope: c.Query("scope"), Workspace: c.Query("workspace"), Visibility: c.Query("visibility"), RAGStatus: c.Query("ragStatus"), Sort: c.Query("sort"), Order: c.Query("order")}
	data, err := h.Service.KnowledgeBases(c.Request.Context(), f, p, n)
	respond(c, data, err)
}
func (h *Controller) KnowledgeBase(c *gin.Context) {
	data, err := h.Service.KnowledgeBase(c.Request.Context(), c.Param("id"))
	respond(c, data, err)
}
func (h *Controller) UpdateKnowledge(c *gin.Context) {
	var input service.KnowledgeUpdate
	if !bind(c, &input) {
		return
	}
	err := h.Service.UpdateKnowledge(c.Request.Context(), c.GetString("actor"), c.Param("id"), input)
	respond(c, gin.H{"id": c.Param("id")}, err)
}
func (h *Controller) KnowledgeFiles(c *gin.Context) {
	p, n, ok := pagination(c)
	if !ok {
		return
	}
	data, err := h.Service.KnowledgeFiles(c.Request.Context(), c.Param("id"), p, n)
	respond(c, data, err)
}
func (h *Controller) KnowledgeDocuments(c *gin.Context) {
	p, n, ok := pagination(c)
	if !ok {
		return
	}
	data, err := h.Service.KnowledgeDocuments(c.Request.Context(), c.Param("id"), p, n)
	respond(c, data, err)
}
func (h *Controller) KnowledgeDocument(c *gin.Context) {
	data, err := h.Service.KnowledgeDocument(c.Request.Context(), c.GetString("actor"), c.Param("id"), c.Param("documentId"))
	respond(c, data, err)
}
func (h *Controller) KnowledgeChunks(c *gin.Context) {
	p, n, ok := pagination(c)
	if !ok {
		return
	}
	data, err := h.Service.KnowledgeChunks(c.Request.Context(), c.GetString("actor"), c.Param("id"), c.Param("fileId"), p, n)
	respond(c, data, err)
}
