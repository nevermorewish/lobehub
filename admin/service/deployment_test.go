package service

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func deploymentFixture(t *testing.T) map[string]string {
	t.Helper()
	_, privateKey, _ := ed25519.GenerateKey(rand.Reader)
	signer, _ := ssh.NewSignerFromKey(privateKey)
	config := &ssh.ServerConfig{PasswordCallback: func(c ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
		if c.User() == "root" && string(password) == "fixture-password" {
			return nil, nil
		}
		return nil, errors.New("invalid credential")
	}}
	config.AddHostKey(signer)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				server, channels, requests, err := ssh.NewServerConn(conn, config)
				if err != nil {
					return
				}
				defer server.Close()
				go ssh.DiscardRequests(requests)
				for channel := range channels {
					c, requests, err := channel.Accept()
					if err != nil {
						return
					}
					for request := range requests {
						if request.Type != "exec" {
							request.Reply(false, nil)
							continue
						}
						var command struct{ Command string }
						ssh.Unmarshal(request.Payload, &command)
						request.Reply(true, nil)
						if strings.Contains(command.Command, "tail -c") {
							io.WriteString(c, "0\n[5/5] Deployment completed\nfixture-password")
						}
						c.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{0}))
						c.Close()
						break
					}
				}
			}()
		}
	}()
	host, port, _ := net.SplitHostPort(listener.Addr().String())
	return map[string]string{"DEPLOY_HOST": host, "DEPLOY_PORT": port, "DEPLOY_USER": "root", "DEPLOY_PASSWORD": "fixture-password", "DEPLOY_HOST_KEY": ssh.FingerprintSHA256(signer.PublicKey()), "DEPLOY_REPOSITORY": "https://github.com/nevermorewish/lobehub.git", "DEPLOY_BRANCH": "canary", "DEPLOY_DIRECTORY": "/opt/lobehub"}
}

func TestDeploymentSSHHostKeyAndPassword(t *testing.T) {
	v := deploymentFixture(t)
	ctx := context.Background()
	fingerprint, err := ProbeDeploymentHost(ctx, v["DEPLOY_HOST"], v["DEPLOY_PORT"])
	if err != nil || fingerprint != v["DEPLOY_HOST_KEY"] {
		t.Fatal("host probe failed", err)
	}
	client, err := connectDeployment(ctx, v)
	if err != nil {
		t.Fatal(err)
	}
	client.Close()
	v["DEPLOY_PASSWORD"] = "wrong-password"
	if _, err := connectDeployment(ctx, v); err == nil {
		t.Fatal("wrong password accepted")
	}
	v["DEPLOY_PASSWORD"] = "fixture-password"
	v["DEPLOY_HOST_KEY"] = "SHA256:" + strings.Repeat("a", 43)
	if _, err := connectDeployment(ctx, v); err == nil {
		t.Fatal("wrong host key accepted")
	}
}

func TestDeploymentLifecycleAndSecretIsolation(t *testing.T) {
	s := testService(t)
	v := deploymentFixture(t)
	ctx := context.Background()
	saved, err := s.SaveSettings(ctx, "operator", "deployment", SettingsInput{Values: v})
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := s.RuntimeSettings(ctx)
	if err != nil || len(runtime) != 0 {
		t.Fatal("SSH settings leaked to application runtime", err)
	}
	job, err := s.StartDeployment(ctx, "operator", saved.Revision)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(job)
	if strings.Contains(string(encoded), "ConfigSecret") || strings.Contains(string(encoded), "fixture-password") {
		t.Fatal("deployment secret exposed")
	}
	if _, err := s.StartDeployment(ctx, "operator", saved.Revision); !errors.Is(err, ErrConflict) {
		t.Fatal("duplicate deployment allowed", err)
	}
	// Simulate a newly constructed service after replacing the admin container.
	restarted := &Service{DB: s.DB, Vault: s.Vault, Config: s.Config}
	status, err := restarted.DeploymentStatus(ctx, job.ID)
	if err != nil || status.Status != "succeeded" || strings.Contains(status.Log, "fixture-password") {
		t.Fatal("resume/status/secret masking failed", err)
	}
	if _, err := s.StartDeployment(ctx, "operator", saved.Revision+1); !errors.Is(err, ErrConflict) {
		t.Fatal("stale configuration deployed", err)
	}
}

func TestDeploymentRejectsShellInjection(t *testing.T) {
	v := deploymentFixture(t)
	for key, value := range map[string]string{"DEPLOY_HOST": "host;id", "DEPLOY_PORT": "22;id", "DEPLOY_USER": "root;id", "DEPLOY_DIRECTORY": "/tmp/app;id", "DEPLOY_BRANCH": "canary;id", "DEPLOY_REPOSITORY": "https://user:secret@github.com/owner/repo.git"} {
		original := v[key]
		v[key] = value
		if validateDeployment(v) == nil {
			t.Fatalf("accepted injected %s", key)
		}
		v[key] = original
	}
	if err := validateDeployment(v); err != nil {
		t.Fatal(err)
	}
}

func TestDeploymentFailedConnectionRemainsReadable(t *testing.T) {
	s := testService(t)
	v := deploymentFixture(t)
	v["DEPLOY_PASSWORD"] = "wrong-password"
	ctx := context.Background()
	saved, err := s.SaveSettings(ctx, "operator", "deployment", SettingsInput{Values: v})
	if err != nil {
		t.Fatal(err)
	}
	job, err := s.StartDeployment(ctx, "operator", saved.Revision)
	if err == nil {
		t.Fatal("invalid password accepted")
	}
	status, err := s.DeploymentStatus(ctx, job.ID)
	if err != nil || status.Status != "failed" || !strings.Contains(status.Log, "SSH authentication") || strings.Contains(status.Log, "wrong-password") {
		t.Fatal("failed connection lost its readable status", status, err)
	}
}
