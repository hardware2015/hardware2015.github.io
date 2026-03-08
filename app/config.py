from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = Field(default="Businessmen United Club", alias="APP_NAME")
    app_env: str = Field(default="production", alias="APP_ENV")
    secret_key: str = Field(default="change-this-secret-key", alias="SECRET_KEY")
    database_url: str = Field(alias="DATABASE_URL")
    session_cookie_name: str = Field(default="buc_session", alias="SESSION_COOKIE_NAME")
    session_max_age_hours: int = Field(default=168, alias="SESSION_MAX_AGE_HOURS")
    cookie_secure: bool = Field(default=True, alias="COOKIE_SECURE")
    allowed_hosts: str = Field(default="localhost,127.0.0.1", alias="ALLOWED_HOSTS")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def allowed_hosts_list(self) -> list[str]:
        return [host.strip() for host in self.allowed_hosts.split(",") if host.strip()]

    @property
    def normalized_database_url(self) -> str:
        if self.database_url.startswith("postgres://"):
            return self.database_url.replace("postgres://", "postgresql+psycopg://", 1)
        if self.database_url.startswith("postgresql://") and not self.database_url.startswith("postgresql+psycopg://"):
            return self.database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        return self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
