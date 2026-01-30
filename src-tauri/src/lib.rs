use std::process::Command;

#[tauri::command]
fn check_wkhtmltopdf_installed() -> bool {
    Command::new("wkhtmltopdf")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
async fn install_wkhtmltopdf_winget() -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    
    std::thread::spawn(move || {
        let result = Command::new("winget")
            .args(["install", "-e", "--id", "wkhtmltopdf.wkhtmltox", "--accept-source-agreements", "--accept-package-agreements"])
            .output();
        let _ = tx.send(result);
    });

    let output = rx.recv()
        .map_err(|e| format!("Erreur de communication: {}", e))?
        .map_err(|e| format!("Erreur lors de l'exécution de winget: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        Err(format!("Installation échouée: {} {}", stdout, stderr))
    }
}

#[tauri::command]
fn convert_word_to_markdown(file_path: &str) -> Result<String, String> {
    convert_to_markdown(file_path, "docx")
}

#[tauri::command]
fn convert_to_markdown_via_pandoc(file_path: &str, from_format: &str) -> Result<String, String> {
    convert_to_markdown(file_path, from_format)
}

fn convert_to_markdown(file_path: &str, from_format: &str) -> Result<String, String> {
    let output = Command::new("pandoc")
        .args([
            "-f", from_format,
            "-t", "markdown-raw_html-native_spans-native_divs",
            "--wrap=none",
            "--extract-media=.",
            file_path
        ])
        .output()
        .map_err(|e| format!("Erreur lors de l'exécution de pandoc: {}. Assurez-vous que pandoc est installé.", e))?;

    if output.status.success() {
        let content = String::from_utf8(output.stdout)
            .map_err(|e| format!("Erreur de conversion UTF-8: {}", e))?;

        // Clean up superscript/subscript HTML tags that might remain
        let content = content
            .replace("<sup>", "^")
            .replace("</sup>", "^")
            .replace("<sub>", "~")
            .replace("</sub>", "~");

        Ok(content)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Pandoc a échoué: {}", stderr))
    }
}

#[tauri::command]
fn export_markdown_via_pandoc(markdown_content: &str, output_path: &str, to_format: &str) -> Result<(), String> {
    let mut args = vec![
        "-f".to_string(), "markdown".to_string(),
        "-t".to_string(), to_format.to_string(),
        "--wrap=none".to_string(),
        "-o".to_string(), output_path.to_string(),
    ];

    if to_format == "pdf" {
        args.push("--pdf-engine=wkhtmltopdf".to_string());
    }

    let output = Command::new("pandoc")
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Erreur lors de l'exécution de pandoc: {}. Assurez-vous que pandoc est installé.", e))?;

    use std::io::Write;
    let mut child = output;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(markdown_content.as_bytes())
            .map_err(|e| format!("Erreur d'écriture vers pandoc: {}", e))?;
    }

    let result = child.wait_with_output()
        .map_err(|e| format!("Erreur lors de l'attente de pandoc: {}", e))?;

    if result.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&result.stderr);
        Err(format!("Pandoc a échoué: {}", stderr))
    }
}

#[tauri::command]
fn export_html_to_temp(html_content: &str) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let path = temp_dir.join("ohmymarkdown_export.html");
    std::fs::write(&path, html_content)
        .map_err(|e| format!("Erreur d'écriture du fichier temporaire: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![convert_word_to_markdown, convert_to_markdown_via_pandoc, export_markdown_via_pandoc, export_html_to_temp, check_wkhtmltopdf_installed, install_wkhtmltopdf_winget])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
