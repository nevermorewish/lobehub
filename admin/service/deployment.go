package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"regexp"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"
	"gorm.io/gorm"
	"lobehub/admin/common"
	"lobehub/admin/model"
)

var deployUser = regexp.MustCompile(`^[a-z_][a-z0-9_-]*$`)
var deployBranch = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,127}$`)
var deployDirectory = regexp.MustCompile(`^/[a-zA-Z0-9_/-]+$`)
var deployRepository = regexp.MustCompile(`^https://github\.com/[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+(?:\.git)?$`)

func validateDeployment(v map[string]string) error {
	port, err := strconv.Atoi(v["DEPLOY_PORT"])
	if net.ParseIP(v["DEPLOY_HOST"]) == nil || err != nil || port < 1 || port > 65535 || !deployUser.MatchString(v["DEPLOY_USER"]) || len(v["DEPLOY_PASSWORD"]) == 0 {
		return ErrInvalid
	}
	if !deployRepository.MatchString(v["DEPLOY_REPOSITORY"]) || !deployBranch.MatchString(v["DEPLOY_BRANCH"]) || strings.Contains(v["DEPLOY_BRANCH"], "..") || strings.Contains(v["DEPLOY_BRANCH"], "//") {
		return ErrInvalid
	}
	if !deployDirectory.MatchString(v["DEPLOY_DIRECTORY"]) || strings.Contains(v["DEPLOY_DIRECTORY"], "//") || len(strings.Trim(v["DEPLOY_DIRECTORY"], "/")) < 3 {
		return ErrInvalid
	}
	if !regexp.MustCompile(`^SHA256:[A-Za-z0-9+/]{43}$`).MatchString(v["DEPLOY_HOST_KEY"]) {
		return ErrInvalid
	}
	return nil
}

// Probe only obtains the public host key. Authentication is deliberately aborted.
func ProbeDeploymentHost(ctx context.Context, host, port string) (string, error) {
	n, err := strconv.Atoi(port)
	if net.ParseIP(host) == nil || err != nil || n < 1 || n > 65535 {
		return "", ErrInvalid
	}
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(host, port))
	if err != nil {
		return "", errors.New("SSH host unavailable")
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	fingerprint := ""
	config := &ssh.ClientConfig{User: "host-key-probe", HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
		fingerprint = ssh.FingerprintSHA256(key)
		return errors.New("host key probe complete")
	}}
	_, _, _, _ = ssh.NewClientConn(conn, net.JoinHostPort(host, port), config)
	if fingerprint == "" {
		return "", errors.New("SSH host key unavailable")
	}
	return fingerprint, nil
}

func connectDeployment(ctx context.Context, values map[string]string) (*ssh.Client, error) {
	address := net.JoinHostPort(values["DEPLOY_HOST"], values["DEPLOY_PORT"])
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, errors.New("SSH connection failed")
	}
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	config := &ssh.ClientConfig{User: values["DEPLOY_USER"], Auth: []ssh.AuthMethod{ssh.Password(values["DEPLOY_PASSWORD"])}, HostKeyCallback: func(_ string, _ net.Addr, key ssh.PublicKey) error {
		if ssh.FingerprintSHA256(key) != values["DEPLOY_HOST_KEY"] {
			return errors.New("SSH host key changed")
		}
		return nil
	}}
	c, channels, requests, err := ssh.NewClientConn(conn, address, config)
	if err != nil {
		conn.Close()
		return nil, errors.New("SSH authentication or host key verification failed")
	}
	return ssh.NewClient(c, channels, requests), nil
}

func shellQuote(value string) string { return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'" }

func deploymentScript(v map[string]string) string {
	dir, repo, branch := shellQuote(v["DEPLOY_DIRECTORY"]), shellQuote(v["DEPLOY_REPOSITORY"]), shellQuote(v["DEPLOY_BRANCH"])
	return fmt.Sprintf(`#!/bin/sh
set -eu
export GIT_TERMINAL_PROMPT=0
echo '[1/5] Checking Linux, Git and Docker Compose'
test "$(uname -s)" = Linux
command -v git >/dev/null
docker info >/dev/null
docker compose version
if [ ! -d %s/.git ]; then
  git clone --branch %s --single-branch -- %s %s
fi
cd %s
test "$(git remote get-url origin)" = %s || { echo 'Repository origin differs from saved configuration'; exit 1; }
test -z "$(git status --porcelain)" || { echo 'Working tree has local changes; commit or move them before deploying'; exit 1; }
test "$(git branch --show-current)" = %s || { echo 'Checked-out branch differs from saved configuration'; exit 1; }
echo '[2/5] Fetching the latest branch'
git fetch origin %s
git merge --ff-only FETCH_HEAD
git rev-parse HEAD
echo '[3/5] Validating Compose and building images'
test -f docker-compose/deploy/.env || { echo 'Configure docker-compose/deploy/.env on the server first'; exit 1; }
docker compose -f docker-compose/deploy/docker-compose.yml config --quiet
docker compose -f docker-compose/deploy/docker-compose.yml build --pull admin lobe
echo '[4/5] Updating containers and waiting for readiness'
docker compose -f docker-compose/deploy/docker-compose.yml up -d --wait --wait-timeout 180
echo '[5/5] Deployment completed'
docker compose -f docker-compose/deploy/docker-compose.yml ps
`, dir, branch, repo, dir, dir, repo, branch, branch)
}

func deploymentRemoteDir(id string) string { return "/var/tmp/lobehub-admin-deployment-" + id }

func (s *Service) StartDeployment(ctx context.Context, actor string, revision int64) (model.Deployment, error) {
	var job model.Deployment
	token, err := common.RandomToken()
	if err != nil {
		return job, err
	}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(742819323)").Error; err != nil {
			return err
		}
		var active int64
		if err := tx.Model(&model.Deployment{}).Where("status IN ?", []string{"running", "unknown"}).Count(&active).Error; err != nil {
			return err
		}
		if active > 0 {
			return ErrConflict
		}
		var config model.Setting
		if err := tx.First(&config, "id = ?", "deployment").Error; err != nil {
			return err
		}
		if config.Revision != revision {
			return ErrConflict
		}
		job = model.Deployment{ID: common.Hash(token)[:32], Actor: actor, Status: "running", ConfigSecret: config.Secret}
		if err := tx.Create(&job).Error; err != nil {
			return err
		}
		return audit(tx, actor, "deployment.start", job.ID)
	})
	if err != nil {
		return job, err
	}
	values, err := s.decodeSettings(model.Setting{ID: "deployment", Secret: job.ConfigSecret})
	if err != nil {
		s.DB.Model(&job).Updates(map[string]any{"status": "failed", "failure": "Unable to read saved deployment configuration"})
		return job, err
	}
	client, err := connectDeployment(ctx, values)
	if err != nil {
		s.DB.Model(&job).Updates(map[string]any{"status": "failed", "failure": err.Error()})
		return job, err
	}
	defer client.Close()
	session, err := client.NewSession()
	if err != nil {
		s.DB.Model(&job).Updates(map[string]any{"status": "failed", "failure": "SSH session could not be opened"})
		return job, err
	}
	defer session.Close()
	dir := shellQuote(deploymentRemoteDir(job.ID))
	// The detached worker survives replacement of the admin container. Its final
	// exit status is kept on the server and re-read after reconnecting.
	worker := "timeout 3600 sh run.sh >output.log 2>&1; result=$?; printf '%s' \"$result\" >exit-code.tmp; mv exit-code.tmp exit-code"
	command := "set -e; umask 077; command -v timeout >/dev/null; command -v nohup >/dev/null; mkdir " + dir + "; cd " + dir + "; printf '%s' " + shellQuote(deploymentScript(values)) + " >run.sh; nohup sh -c " + shellQuote(worker) + " </dev/null >/dev/null 2>&1 &"
	if err := session.Run(command); err != nil {
		s.DB.Model(&job).Update("status", "unknown")
		return job, errors.New("deployment launch uncertain; refresh deployment status")
	}
	return job, nil
}

type DeploymentView struct {
	model.Deployment
	Log string `json:"log"`
}

func (s *Service) DeploymentStatus(ctx context.Context, id string) (DeploymentView, error) {
	var job model.Deployment
	if err := s.DB.WithContext(ctx).First(&job, "id = ?", id).Error; err != nil {
		return DeploymentView{}, err
	}
	if job.Status == "failed" && job.Failure != "" {
		return DeploymentView{Deployment: job, Log: job.Failure}, nil
	}
	values, err := s.decodeSettings(model.Setting{ID: "deployment", Secret: job.ConfigSecret})
	if err != nil {
		return DeploymentView{}, err
	}
	client, err := connectDeployment(ctx, values)
	if err != nil {
		return DeploymentView{Deployment: job}, err
	}
	defer client.Close()
	session, err := client.NewSession()
	if err != nil {
		return DeploymentView{}, err
	}
	defer session.Close()
	dir := shellQuote(deploymentRemoteDir(job.ID))
	output, err := session.Output("cd " + dir + " && { if [ -f exit-code ]; then cat exit-code; else printf running; fi; printf '\\n'; tail -c 32768 output.log 2>/dev/null || true; }")
	if err != nil {
		return DeploymentView{Deployment: job}, errors.New("remote deployment log unavailable")
	}
	parts := strings.SplitN(string(output), "\n", 2)
	status := "running"
	if parts[0] == "0" {
		status = "succeeded"
	} else if parts[0] != "running" {
		status = "failed"
	}
	if status != job.Status {
		if err := s.DB.WithContext(ctx).Model(&job).Update("status", status).Error; err != nil {
			return DeploymentView{}, err
		}
		job.Status = status
	}
	log := ""
	if len(parts) == 2 {
		log = parts[1]
	}
	// Never expose even accidentally echoed SSH credentials.
	log = strings.ReplaceAll(log, values["DEPLOY_PASSWORD"], "[redacted]")
	return DeploymentView{Deployment: job, Log: log}, nil
}
