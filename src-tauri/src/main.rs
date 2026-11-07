// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by Claude Desktop or Claude Code as an MCP server: answer on stdin/stdout
    // and never open a window.
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--mcp") {
        std::process::exit(axisnotes_lib::mcp_main(&args));
    }
    axisnotes_lib::run();
}
