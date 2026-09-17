package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"lobehub/admin/common"
	"lobehub/admin/router"
	"lobehub/admin/service"
)

//go:embed all:web/default/dist
var frontend embed.FS

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		port := os.Getenv("PORT")
		if port == "" {
			port = "3211"
		}
		client := http.Client{Timeout: 3 * time.Second}
		response, err := client.Get("http://127.0.0.1:" + port + "/healthz")
		if err != nil {
			os.Exit(1)
		}
		response.Body.Close()
		if response.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}
func run() error {
	config, err := common.LoadConfig()
	if err != nil {
		return err
	}
	s, err := service.New(config)
	if err != nil {
		return err
	}
	defer s.Close()
	web, err := fs.Sub(frontend, "web/default/dist")
	if err != nil {
		return err
	}
	gin.SetMode(gin.ReleaseMode)
	server := &http.Server{Addr: ":" + config.Port, Handler: router.New(s, web), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	result := make(chan error, 1)
	go func() { log.Printf("LobeHub admin listening on :%s", config.Port); result <- server.ListenAndServe() }()
	select {
	case err := <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		deadline, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(deadline); err != nil {
			_ = server.Close()
			return err
		}
		return nil
	}
}
