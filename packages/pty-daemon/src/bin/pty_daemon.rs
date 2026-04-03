fn main() {
    let args: Vec<String> = std::env::args().collect();
    let socket_path = args.get(1).cloned().unwrap_or_else(|| {
        eprintln!("usage: superagent-pty-daemon <socket-path>");
        std::process::exit(1);
    });

    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    rt.block_on(pty_daemon_lib::daemon::run(socket_path));
}
