from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "mysoc"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    app_base_url: str = "http://localhost:9999"
    database_url: str = "sqlite+aiosqlite:///./mysoc.db"
    ollama_url: str = "http://192.168.1.14:11434/api/generate"
    udp_host: str = "0.0.0.0"
    udp_port: int = 514
    udp_batch_size: int = 200
    udp_flush_interval: float = 1.0
    max_timeline_events: int = 50000
    ollama_num_ctx: int = 32768
    default_lookback_minutes: int = 60
    geoip_provider: str = "dbip-lite"
    mmdb_path: str = "./data/dbip/dbip-city-lite.mmdb"
    geoip_download_url: str = "https://db-ip.com/db/download/ip-to-city-lite"
    geoip_enable_download: bool = True
    timezone: str = Field(default="Europe/Rome", alias="TZ")
    internal_subnets_default: list[str] = [
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "127.0.0.0/8",
        "::1/128",
        "fc00::/7",
    ]

    @property
    def is_postgres(self) -> bool:
        return self.database_url.startswith("postgresql+asyncpg")


@lru_cache
def get_settings() -> Settings:
    return Settings()
