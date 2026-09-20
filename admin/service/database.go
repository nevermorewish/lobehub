package service

import (
	"context"
	"errors"
	"time"

	"lobehub/admin/common"
	"lobehub/admin/model"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"gorm.io/gorm/logger"
)

var (
	ErrConflict            = errors.New("record changed; reload and try again")
	ErrInvalid             = errors.New("invalid input")
	ErrInsufficientCredits = errors.New("insufficient available credits")
	ErrUnauthorized        = errors.New("invalid username or password")
	ErrLastAdmin           = errors.New("the last active administrator cannot be deleted")
)

type Service struct {
	DB        *gorm.DB
	Vault     *common.Vault
	Config    common.Config
	dummyHash []byte
}

func New(config common.Config) (*Service, error) {
	db, err := gorm.Open(postgres.Open(config.DatabaseURL), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent), TranslateError: true})
	if err != nil {
		return nil, errors.New("unable to connect to PostgreSQL")
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(15)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	vault, err := common.NewVault(config.EncryptionKey)
	if err != nil {
		sqlDB.Close()
		return nil, err
	}
	s := &Service{DB: db, Vault: vault, Config: config}
	s.dummyHash, err = bcrypt.GenerateFromPassword([]byte(config.Password), bcrypt.DefaultCost)
	if err == nil {
		err = s.migrate()
	}
	if err != nil {
		sqlDB.Close()
		return nil, err
	}
	return s, nil
}

func (s *Service) Close() error {
	db, err := s.DB.DB()
	if err != nil {
		return err
	}
	return db.Close()
}

func (s *Service) migrate() error {
	return s.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(742819321)").Error; err != nil {
			return err
		}
		if err := tx.AutoMigrate(&model.Administrator{}, &model.Session{}, &model.Provider{}, &model.Price{}, &model.Payment{}, &model.Audit{}, &model.Setting{}, &model.Deployment{}, &model.DeletedUser{}); err != nil {
			return err
		}
		if err := tx.Exec("CREATE UNIQUE INDEX IF NOT EXISTS admin_price_one_active ON admin_model_prices (provider, model_id) WHERE is_active = true AND archived_at IS NULL").Error; err != nil {
			return err
		}
		// Bootstrap once. Changing the environment does not silently reset an existing account.
		if err := tx.Exec("CREATE SEQUENCE IF NOT EXISTS admin_provider_id_seq").Error; err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.Administrator{Username: s.Config.Username, PasswordHash: string(s.dummyHash)}).Error
	})
}

func audit(tx *gorm.DB, actor, action, target string) error {
	return tx.Create(&model.Audit{Actor: actor, Action: action, Target: target}).Error
}

func (s *Service) Login(ctx context.Context, username, password string) (string, error) {
	var admin model.Administrator
	err := s.DB.WithContext(ctx).First(&admin, "username = ?", username).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	hash := s.dummyHash
	if err == nil {
		hash = []byte(admin.PasswordHash)
	}
	if bcrypt.CompareHashAndPassword(hash, []byte(password)) != nil || err != nil {
		return "", ErrUnauthorized
	}
	token, err := common.RandomToken()
	if err != nil {
		return "", err
	}
	err = s.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("expires_at < ?", time.Now()).Delete(&model.Session{}).Error; err != nil {
			return err
		}
		if err := tx.Create(&model.Session{TokenHash: common.Hash(token), Username: username, ExpiresAt: time.Now().Add(12 * time.Hour)}).Error; err != nil {
			return err
		}
		return audit(tx, username, "auth.login", username)
	})
	return token, err
}

func (s *Service) Authenticate(ctx context.Context, token string) (string, error) {
	var session model.Session
	if token == "" {
		return "", ErrUnauthorized
	}
	if err := s.DB.WithContext(ctx).First(&session, "token_hash = ? AND expires_at > ?", common.Hash(token), time.Now()).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", ErrUnauthorized
		}
		return "", err
	}
	return session.Username, nil
}

func (s *Service) Logout(ctx context.Context, token string) error {
	return s.DB.WithContext(ctx).Delete(&model.Session{}, "token_hash = ?", common.Hash(token)).Error
}
