fn main() {
    let args: Vec<String> = std::env::args().collect();
    let socket_path = args.get(1).cloned().unwrap_or_else(|| {
        eprintln!("usage: superagent-pty-daemon <socket-path> [parent-pid]");
        std::process::exit(1);
    });
    let parent_pid: Option<u32> = args.get(2).and_then(|s| s.parse().ok());

    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    rt.block_on(pty_daemon_lib::daemon::run(socket_path, parent_pid));
}
