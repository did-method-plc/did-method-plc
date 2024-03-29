package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/flosch/pongo2/v6"
	"github.com/klauspost/compress/gzhttp"
	"github.com/klauspost/compress/gzip"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/russross/blackfriday/v2"
	"github.com/urfave/cli/v2"
)

//go:embed templates/*
var TemplateFS embed.FS

//go:embed static/*
var StaticFS embed.FS

//go:embed spec/v0.1/did-plc.md
var specZeroOneMarkdown []byte

//go:embed spec/plc-server-openapi3.yaml
var apiOpenapiYaml []byte

type Server struct {
	echo    *echo.Echo
	httpd   *http.Server
	client  *http.Client
	plcHost string
}

func serve(cctx *cli.Context) error {
	debug := cctx.Bool("debug")
	httpAddress := cctx.String("http-address")

	// Echo
	e := echo.New()

	// create a new session (no auth)
	client := http.Client{
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          100,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   10 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}

	// httpd variable
	var (
		httpTimeout          = 2 * time.Minute
		httpMaxHeaderBytes   = 2 * (1024 * 1024)
		gzipMinSizeBytes     = 1024 * 2
		gzipCompressionLevel = gzip.BestSpeed
		gzipExceptMIMETypes  = []string{"image/png"}
	)

	// Wrap the server handler in a gzip handler to compress larger responses.
	gzipHandler, err := gzhttp.NewWrapper(
		gzhttp.MinSize(gzipMinSizeBytes),
		gzhttp.CompressionLevel(gzipCompressionLevel),
		gzhttp.ExceptContentTypes(gzipExceptMIMETypes),
	)
	if err != nil {
		return err
	}

	server := &Server{
		echo:    e,
		client:  &client,
		plcHost: cctx.String("plc-host"),
	}

	server.httpd = &http.Server{
		Handler:        gzipHandler(server),
		Addr:           httpAddress,
		WriteTimeout:   httpTimeout,
		ReadTimeout:    httpTimeout,
		MaxHeaderBytes: httpMaxHeaderBytes,
	}

	e.HideBanner = true
	// SECURITY: Do not modify without due consideration.
	e.Use(middleware.SecureWithConfig(middleware.SecureConfig{
		ContentTypeNosniff: "nosniff",
		XFrameOptions:      "SAMEORIGIN",
		HSTSMaxAge:         31536000, // 365 days
		// TODO:
		// ContentSecurityPolicy
		// XSSProtection
	}))
	e.Use(middleware.LoggerWithConfig(middleware.LoggerConfig{
		// Don't log requests for static content.
		Skipper: func(c echo.Context) bool {
			return strings.HasPrefix(c.Request().URL.Path, "/static")
		},
	}))
	e.Renderer = NewRenderer("templates/", &TemplateFS, debug)
	e.HTTPErrorHandler = server.errorHandler

	// redirect trailing slash to non-trailing slash.
	// all of our current endpoints have no trailing slash.
	e.Use(middleware.RemoveTrailingSlashWithConfig(middleware.TrailingSlashConfig{
		RedirectCode: http.StatusFound,
	}))

	staticHandler := http.FileServer(func() http.FileSystem {
		if debug {
			log.Debugf("serving static file from the local file system")
			return http.FS(os.DirFS("static"))
		}
		fsys, err := fs.Sub(StaticFS, "static")
		if err != nil {
			log.Fatal(err)
		}
		return http.FS(fsys)
	}())

	// static file routes
	e.GET("/robots.txt", echo.WrapHandler(staticHandler))
	e.GET("/favicon.ico", echo.WrapHandler(staticHandler))
	e.GET("/static/*", echo.WrapHandler(http.StripPrefix("/static/", staticHandler)))
	e.GET("/.well-known/*", echo.WrapHandler(staticHandler))
	e.GET("/security.txt", func(c echo.Context) error {
		return c.Redirect(http.StatusMovedPermanently, "/.well-known/security.txt")
	})

	// meta stuff
	e.GET("/_health", server.WebHealth)
	e.GET("/healthz", server.WebHealth)

	// actual pages/views
	e.GET("/", server.WebHome)
	e.GET("/resolve", server.WebResolve)
	e.GET("/did/:did", server.WebDid)
	e.GET("/spec/v0.1/did-plc", server.WebSpecZeroOne)
	e.GET("/api/redoc", server.WebRedoc)
	e.GET("/api/plc-server-openapi3.yaml", server.WebOpenapiYaml)

	// Start the server.
	log.Infof("starting server address=%s", httpAddress)
	go func() {
		if err := server.httpd.ListenAndServe(); err != nil {
			if !errors.Is(err, http.ErrServerClosed) {
				log.Errorf("HTTP server shutting down unexpectedly: %s", err)
			}
		}
	}()

	// Wait for a signal to exit.
	log.Info("registering OS exit signal handler")
	quit := make(chan struct{})
	exitSignals := make(chan os.Signal, 1)
	signal.Notify(exitSignals, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		sig := <-exitSignals
		log.Infof("received OS exit signal: %s", sig)

		// Shut down the HTTP server.
		if err := server.Shutdown(); err != nil {
			log.Errorf("HTTP server shutdown error: %s", err)
		}

		// Trigger the return that causes an exit.
		close(quit)
	}()
	<-quit
	log.Infof("graceful shutdown complete")
	return nil
}

func (srv *Server) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	srv.echo.ServeHTTP(rw, req)
}

func (srv *Server) Shutdown() error {
	log.Info("shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	return srv.httpd.Shutdown(ctx)
}

func (srv *Server) errorHandler(err error, c echo.Context) {
	code := http.StatusInternalServerError
	errorMessage := ""
	if he, ok := err.(*echo.HTTPError); ok {
		code = he.Code
		if he.Message != nil {
			errorMessage = fmt.Sprintf("%s", he.Message)
		}
	}
	c.Logger().Error(err)
	data := pongo2.Context{
		"statusCode":   code,
		"errorMessage": errorMessage,
	}
	if err = c.Render(code, "templates/error.html", data); err != nil {
		c.Logger().Error(err)
	}
}

func (srv *Server) WebHome(c echo.Context) error {
	data := pongo2.Context{}
	return c.Render(http.StatusOK, "templates/home.html", data)
}

func (srv *Server) WebSpecZeroOne(c echo.Context) error {
	data := pongo2.Context{}
	data["html_title"] = "did:plc Specification v0.1"
	data["markdown_html"] = string(blackfriday.Run(specZeroOneMarkdown))
	return c.Render(http.StatusOK, "templates/markdown.html", data)
}

func (srv *Server) WebHealth(c echo.Context) error {
	resp := map[string]interface{}{
		"status": "ok",
	}
	return c.JSON(http.StatusOK, resp)
}

func (srv *Server) WebOpenapiYaml(c echo.Context) error {
	return c.Blob(http.StatusOK, "text/yaml", apiOpenapiYaml)
}

func (srv *Server) WebRedoc(c echo.Context) error {
	data := pongo2.Context{}
	return c.Render(http.StatusOK, "templates/redoc.html", data)
}

func (srv *Server) WebResolve(c echo.Context) error {
	data := pongo2.Context{}
	did := c.QueryParam("did")
	if did != "" {
		return c.Redirect(http.StatusMovedPermanently, "/did/"+did)
	}
	return c.Render(http.StatusOK, "templates/resolve.html", data)
}

func (srv *Server) WebDid(c echo.Context) error {
	data := pongo2.Context{}
	did := c.Param("did")
	data["did"] = did
	if !strings.HasPrefix(did, "did:plc:") {
		return echo.NewHTTPError(http.StatusBadRequest, fmt.Errorf("Not a valid DID PLC identifier: %s", did))
	}
	res, err := ResolveDidPlc(srv.client, srv.plcHost, did)
	if err != nil {
		return err
	}
	if res.StatusCode == 404 {
		return echo.NewHTTPError(http.StatusNotFound, fmt.Errorf("DID not in PLC directory: %s", did))
	}
	if res.StatusCode == 410 {
		return echo.NewHTTPError(http.StatusNotFound, fmt.Errorf("DID has been permanently deleted: %s", did))
	}
	data["result"] = res
	return c.Render(http.StatusOK, "templates/did.html", data)
}
