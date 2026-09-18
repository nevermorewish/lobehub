package controller

import (
	"github.com/gin-gonic/gin"
	"lobehub/admin/model"
	"lobehub/admin/service"
)

func (h *Controller) ProbeDeployment(c *gin.Context) {
	var input struct {
		Host string `json:"host"`
		Port string `json:"port"`
	}
	if !bind(c, &input) {
		return
	}
	fingerprint, err := service.ProbeDeploymentHost(c.Request.Context(), input.Host, input.Port)
	respond(c, gin.H{"fingerprint": fingerprint}, err)
}

func (h *Controller) StartDeployment(c *gin.Context) {
	var input struct {
		Revision int64 `json:"revision"`
	}
	if !bind(c, &input) {
		return
	}
	data, err := h.Service.StartDeployment(c.Request.Context(), c.GetString("actor"), input.Revision)
	respond(c, data, err)
}

func (h *Controller) Deployments(c *gin.Context) {
	data := []model.Deployment{}
	err := h.Service.DB.WithContext(c.Request.Context()).Order("created_at DESC").Limit(20).Find(&data).Error
	if err == nil {
		for i, job := range data {
			if job.Status == "running" || job.Status == "unknown" {
				// Reconcile detached work after admin/container restarts, even when
				// the operator is viewing an older deployment's log.
				if current, statusErr := h.Service.DeploymentStatus(c.Request.Context(), job.ID); statusErr == nil {
					data[i] = current.Deployment
				}
			}
		}
	}
	respond(c, data, err)
}

func (h *Controller) DeploymentStatus(c *gin.Context) {
	data, err := h.Service.DeploymentStatus(c.Request.Context(), c.Param("id"))
	respond(c, data, err)
}
