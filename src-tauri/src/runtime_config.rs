//! 后端运行配置文件。只保存具备安全默认值、程序启动必需的非敏感参数。

use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    db::settings_repo::TransferIntervals,
    error::{backend_error, BackendClientError},
};

pub const CONFIG_FILE_NAME: &str = "config.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RuntimeConfig {
    pub version: u32,
    pub transfer_intervals: TransferIntervals,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            version: 1,
            transfer_intervals: TransferIntervals::default(),
        }
    }
}

impl RuntimeConfig {
    fn normalized(mut self) -> Self {
        self.version = 1;
        self.transfer_intervals = self.transfer_intervals.normalized();
        self
    }
}

#[derive(Clone)]
pub struct RuntimeConfigState {
    path: PathBuf,
    current: Arc<RwLock<RuntimeConfig>>,
    save_lock: Arc<Mutex<()>>,
}

impl RuntimeConfigState {
    pub fn load_or_create(path: PathBuf) -> Result<Self, BackendClientError> {
        let config = if path.exists() {
            read_config(&path)?
        } else {
            let config = RuntimeConfig::default();
            write_config_atomic(&path, &config)?;
            tracing::info!(?path, "运行配置文件不存在，已写入默认配置");
            config
        };
        Ok(Self {
            path,
            current: Arc::new(RwLock::new(config)),
            save_lock: Arc::new(Mutex::new(())),
        })
    }

    pub fn get(&self) -> Result<RuntimeConfig, BackendClientError> {
        self.current
            .read()
            .map(|value| value.clone())
            .map_err(|_| backend_error("config", -7, "运行配置锁定失败"))
    }

    /// 先原子写盘，再更新内存；写盘失败时运行中的配置保持不变。
    pub fn save_and_reload(
        &self,
        update: impl FnOnce(&mut RuntimeConfig),
    ) -> Result<RuntimeConfig, BackendClientError> {
        let _save_guard = self
            .save_lock
            .lock()
            .map_err(|_| backend_error("config", -7, "运行配置保存锁定失败"))?;
        let mut next = self.get()?;
        update(&mut next);
        next = next.normalized();
        write_config_atomic(&self.path, &next)?;
        let reloaded = read_config(&self.path)?;
        *self
            .current
            .write()
            .map_err(|_| backend_error("config", -7, "运行配置锁定失败"))? = reloaded.clone();
        Ok(reloaded)
    }
}

fn read_config(path: &Path) -> Result<RuntimeConfig, BackendClientError> {
    let json = fs::read_to_string(path)
        .map_err(|e| backend_error("config", -7, format!("读取运行配置失败：{e}")))?;
    serde_json::from_str::<RuntimeConfig>(&json)
        .map(RuntimeConfig::normalized)
        .map_err(|e| backend_error("config", -2, format!("运行配置格式无效：{e}")))
}

fn write_config_atomic(path: &Path, config: &RuntimeConfig) -> Result<(), BackendClientError> {
    let parent = path
        .parent()
        .ok_or_else(|| backend_error("config", -7, "运行配置路径无父目录"))?;
    fs::create_dir_all(parent)
        .map_err(|e| backend_error("config", -7, format!("创建配置目录失败：{e}")))?;
    let temp = parent.join(format!(".{CONFIG_FILE_NAME}.{}.tmp", uuid::Uuid::now_v7()));
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| backend_error("config", -2, format!("序列化运行配置失败：{e}")))?;
    fs::write(&temp, format!("{json}\n"))
        .map_err(|e| backend_error("config", -7, format!("写入临时配置失败：{e}")))?;
    fs::rename(&temp, path)
        .map_err(|e| backend_error("config", -7, format!("替换运行配置失败：{e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|e| backend_error("config", -7, format!("限制配置文件权限失败：{e}")))?;
    }
    Ok(())
}

pub fn init(app: &AppHandle) -> Result<(), BackendClientError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| backend_error("config", -7, format!("获取配置目录失败：{e}")))?;
    let state = RuntimeConfigState::load_or_create(dir.join(CONFIG_FILE_NAME))?;
    app.manage(state);
    Ok(())
}

pub fn state(app: &AppHandle) -> Result<RuntimeConfigState, BackendClientError> {
    app.try_state::<RuntimeConfigState>()
        .map(|value| value.inner().clone())
        .ok_or_else(|| backend_error("config", -7, "运行配置未初始化"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ydisks-config-{name}-{}.json",
            uuid::Uuid::now_v7()
        ))
    }

    #[test]
    fn missing_file_is_created_with_defaults() {
        let path = temp_path("missing");
        let state = RuntimeConfigState::load_or_create(path.clone()).unwrap();
        assert_eq!(state.get().unwrap(), RuntimeConfig::default());
        assert!(path.exists());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn save_reloads_and_enforces_minimum() {
        let path = temp_path("save");
        let state = RuntimeConfigState::load_or_create(path.clone()).unwrap();
        let saved = state
            .save_and_reload(|config| {
                config.transfer_intervals = TransferIntervals {
                    quark: 1,
                    baidu: 7,
                    xunlei: 9,
                };
            })
            .unwrap();
        assert_eq!(saved.transfer_intervals.quark, 3);
        assert_eq!(read_config(&path).unwrap(), saved);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn malformed_existing_file_is_not_overwritten() {
        let path = temp_path("malformed");
        fs::write(&path, "not-json").unwrap();
        assert!(RuntimeConfigState::load_or_create(path.clone()).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "not-json");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn missing_fields_use_safe_defaults() {
        let path = temp_path("partial");
        fs::write(&path, r#"{"transferIntervals":{"quark":8}}"#).unwrap();
        let config = RuntimeConfigState::load_or_create(path.clone())
            .unwrap()
            .get()
            .unwrap();
        assert_eq!(config.version, 1);
        assert_eq!(config.transfer_intervals.quark, 8);
        assert_eq!(config.transfer_intervals.baidu, 4);
        assert_eq!(config.transfer_intervals.xunlei, 4);
        let _ = fs::remove_file(path);
    }
}
