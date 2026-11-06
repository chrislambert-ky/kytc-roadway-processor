#[tauri::command]
async fn save_export(
  app: tauri::AppHandle,
  filename: String,
  data: Vec<u8>,
) -> Result<Option<String>, String> {
  use tauri::Manager;
  use tauri_plugin_dialog::{DialogExt, FilePath};

  let download_dir = app
    .path()
    .download_dir()
    .map_err(|error| format!("Could not find the Downloads folder: {error}"))?;

  let Some(file_path) = app
    .dialog()
    .file()
    .set_directory(download_dir)
    .set_file_name(filename)
    .blocking_save_file()
  else {
    return Ok(None);
  };

  let path = match file_path {
    FilePath::Path(path) => path,
    FilePath::Url(url) => url
      .to_file_path()
      .map_err(|_| format!("Could not convert the selected path to a local file: {url}"))?,
  };

  std::fs::write(&path, data)
    .map_err(|error| format!("Could not save export to {}: {error}", path.display()))?;

  Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .invoke_handler(tauri::generate_handler![save_export])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
