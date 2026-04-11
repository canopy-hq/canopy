fn main() {
    // Load .env.local from repo root so CANOPY_GITHUB_CLIENT_ID
    // is available to option_env!() at compile time.
    let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..");
    let env_file = repo_root.join(".env.local");
    if env_file.exists() {
        println!("cargo:rerun-if-changed={}", env_file.display());
        for item in dotenvy::from_path_iter(&env_file).expect(".env.local parse error") {
            let (key, value) = item.expect(".env.local entry error");
            if !value.is_empty() {
                println!("cargo:rustc-env={key}={value}");
            }
        }
    }

    tauri_build::build()
}
