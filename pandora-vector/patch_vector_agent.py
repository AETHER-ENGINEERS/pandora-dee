#!/usr/bin/env python3
"""Add the tools Jade needs to Vector's official vector-agent (MCP server):
send_message (DM or channel, threaded replies), react, send_typing, edit_message, delete_message,
send_file_bytes (a file sent as base64, DM or channel), download_attachment (returns base64) and
get_new_events (reactions, edits, deletes, community invites, removals).

Usage: python3 patch_vector_agent.py <path to Vector/crates/vector-agent>
Safe to run twice: an already patched tree is left alone.
"""
import sys, pathlib

MARK = '// jade-vector additions'

HELPERS = r'''
// jade-vector additions: request types and helpers for the tools Jade Vault uses.

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct JadeSendRequest {
    #[schemars(description = "Chat id: an npub for a DM, or a Community channel id")]
    pub chat_id: String,
    #[schemars(description = "Message content")]
    pub content: String,
    #[schemars(description = "Optional id of a message to answer as a threaded reply")]
    #[serde(default)]
    pub replied_to: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct JadeReactRequest {
    #[schemars(description = "Chat id: an npub for a DM, or a Community channel id")]
    pub chat_id: String,
    #[schemars(description = "Id of the message to react to")]
    pub message_id: String,
    #[schemars(description = "A unicode emoji, e.g. 👍")]
    pub emoji: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct JadeChatRequest {
    #[schemars(description = "Chat id: an npub for a DM, or a Community channel id")]
    pub chat_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct JadeEditRequest {
    #[schemars(description = "Chat id: an npub for a DM, or a Community channel id")]
    pub chat_id: String,
    #[schemars(description = "Id of a message this account sent")]
    pub message_id: String,
    #[schemars(description = "The new content")]
    pub content: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct JadeMessageRefRequest {
    #[schemars(description = "Chat id: an npub for a DM, or a Community channel id")]
    pub chat_id: String,
    #[schemars(description = "Id of a message this account sent")]
    pub message_id: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct JadeFileBytesRequest {
    #[schemars(description = "Chat id: an npub for a DM, or a Community channel id")]
    pub chat_id: String,
    #[schemars(description = "File name shown to the recipient, e.g. photo.jpg")]
    pub name: String,
    #[schemars(description = "The file's bytes, base64-encoded")]
    pub base64: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct JadeDownloadRequest {
    #[schemars(description = "Id of the message carrying the attachment")]
    pub message_id: String,
    #[schemars(description = "Which attachment of the message (default 0)")]
    #[serde(default)]
    pub index: usize,
    #[schemars(description = "Refuse files bigger than this many megabytes (default 25)")]
    #[serde(default = "jade_default_max_mb")]
    pub max_mb: u64,
}

fn jade_default_max_mb() -> u64 { 25 }

fn jade_is_dm(chat_id: &str) -> bool {
    chat_id.starts_with("npub1")
}

fn jade_ok(text: String) -> Result<CallToolResult, McpError> {
    Ok(CallToolResult::success(vec![Content::text(text)]))
}

fn jade_err(e: impl std::fmt::Display) -> Result<CallToolResult, McpError> {
    Ok(CallToolResult::error(vec![Content::text(e.to_string())]))
}

const JADE_B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn jade_b64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        let n = ((chunk[0] as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        out.push(JADE_B64[((n >> 18) & 63) as usize] as char);
        out.push(JADE_B64[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { JADE_B64[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { JADE_B64[(n & 63) as usize] as char } else { '=' });
    }
    out
}

fn jade_b64_decode(s: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len() / 4 * 3 + 3);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for c in s.bytes() {
        let v: u8 = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' | b'\n' | b'\r' | b' ' | b'\t' => continue,
            _ => return None,
        };
        acc = (acc << 6) | (v as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((acc >> bits) & 0xff) as u8);
            acc &= (1u32 << bits) - 1;
        }
    }
    Some(out)
}

fn jade_safe_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or("");
    let clean: String = base
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' })
        .collect();
    let clean = clean.trim().trim_start_matches('.').to_string();
    if clean.is_empty() { "file".to_string() } else { clean }
}

'''

TOOLS = r'''
    // === jade-vector additions: one call shape for DMs and Community channels ===

    #[tool(description = "Send a message to any chat: an npub (DM) or a Community channel id. Set replied_to to answer a message as a threaded reply. Returns the new message id as JSON {message_id}.")]
    async fn send_message(&self, Parameters(req): Parameters<JadeSendRequest>) -> Result<CallToolResult, McpError> {
        let reply_to = req.replied_to.as_deref().filter(|s| !s.is_empty());
        let res: vector_core::Result<String> = if jade_is_dm(&req.chat_id) {
            let sent = match reply_to {
                Some(r) => self.core.send_dm_reply(&req.chat_id, r, &req.content).await,
                None => self.core.send_dm(&req.chat_id, &req.content).await,
            };
            sent.map(|r| r.event_id.unwrap_or(r.pending_id))
        } else {
            self.core.send_community_message(&req.chat_id, &req.content, reply_to).await
        };
        match res {
            Ok(id) => jade_ok(serde_json::json!({ "message_id": id }).to_string()),
            Err(e) => jade_err(e),
        }
    }

    #[tool(description = "React to a message with an emoji, in a DM (chat_id = npub) or a Community channel.")]
    async fn react(&self, Parameters(req): Parameters<JadeReactRequest>) -> Result<CallToolResult, McpError> {
        let res: vector_core::Result<()> = if jade_is_dm(&req.chat_id) {
            self.core.send_reaction(&req.chat_id, &req.message_id, &req.emoji, None).await.map(|_| ())
        } else {
            self.core.send_community_reaction(&req.chat_id, &req.message_id, &req.emoji, None).await
        };
        match res {
            Ok(()) => jade_ok("reacted".to_string()),
            Err(e) => jade_err(e),
        }
    }

    #[tool(description = "Show a typing indicator in a chat (lasts a few seconds; send again while still working).")]
    async fn send_typing(&self, Parameters(req): Parameters<JadeChatRequest>) -> Result<CallToolResult, McpError> {
        let res: vector_core::Result<()> = if jade_is_dm(&req.chat_id) {
            self.core.send_typing(&req.chat_id).await
        } else {
            self.core.send_community_typing(&req.chat_id).await
        };
        match res {
            Ok(()) => jade_ok("typing".to_string()),
            Err(e) => jade_err(e),
        }
    }

    #[tool(description = "Edit a message this account sent, in a DM or a Community channel.")]
    async fn edit_message(&self, Parameters(req): Parameters<JadeEditRequest>) -> Result<CallToolResult, McpError> {
        let res: vector_core::Result<()> = if jade_is_dm(&req.chat_id) {
            self.core.edit_dm(&req.chat_id, &req.message_id, &req.content).await.map(|_| ())
        } else {
            self.core.edit_community_message(&req.chat_id, &req.message_id, &req.content).await
        };
        match res {
            Ok(()) => jade_ok("edited".to_string()),
            Err(e) => jade_err(e),
        }
    }

    #[tool(description = "Delete a message this account sent, in a DM or a Community channel.")]
    async fn delete_message(&self, Parameters(req): Parameters<JadeMessageRefRequest>) -> Result<CallToolResult, McpError> {
        let res: vector_core::Result<()> = if jade_is_dm(&req.chat_id) {
            self.core.delete_dm(&req.message_id).await.map(|_| ())
        } else {
            self.core.delete_community_message(&req.message_id).await
        };
        match res {
            Ok(()) => jade_ok("deleted".to_string()),
            Err(e) => jade_err(e),
        }
    }

    #[tool(description = "Send a file given as base64 bytes (no file path needed), as an encrypted attachment in a DM or a Community channel. Returns JSON {message_id}.")]
    async fn send_file_bytes(&self, Parameters(req): Parameters<JadeFileBytesRequest>) -> Result<CallToolResult, McpError> {
        let Some(bytes) = jade_b64_decode(&req.base64) else {
            return jade_err("base64 is not valid");
        };
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join("jade-vector").join(format!("{}-{}", std::process::id(), stamp));
        if let Err(e) = std::fs::create_dir_all(&dir) {
            return jade_err(e);
        }
        let path = dir.join(jade_safe_name(&req.name));
        if let Err(e) = std::fs::write(&path, &bytes) {
            let _ = std::fs::remove_dir_all(&dir);
            return jade_err(e);
        }
        let path_s = path.to_string_lossy().into_owned();
        let res: vector_core::Result<String> = if jade_is_dm(&req.chat_id) {
            self.core.send_file(&req.chat_id, &path_s).await.map(|r| r.event_id.unwrap_or(r.pending_id))
        } else {
            self.core.send_community_file(&req.chat_id, &path_s).await
        };
        let _ = std::fs::remove_dir_all(&dir);
        match res {
            Ok(id) => jade_ok(serde_json::json!({ "message_id": id }).to_string()),
            Err(e) => jade_err(e),
        }
    }

    #[tool(description = "Download and decrypt an attachment of a received (or sent) message. Returns JSON {name, extension, size, base64}.")]
    async fn download_attachment(&self, Parameters(req): Parameters<JadeDownloadRequest>) -> Result<CallToolResult, McpError> {
        let Some((chat_id, msg)) = self.core.get_message(&req.message_id).await else {
            return jade_err("No such message");
        };
        let Some(att) = msg.attachments.get(req.index) else {
            return jade_err(format!("That message has {} attachment(s)", msg.attachments.len()));
        };
        let author: Option<String> = if msg.mine {
            self.core.my_npub()
        } else {
            msg.npub.clone().or_else(|| if jade_is_dm(&chat_id) { Some(chat_id.clone()) } else { None })
        };
        match self.core.download_attachment_from(att, author.as_deref()).await {
            Ok(bytes) => {
                let max = req.max_mb.saturating_mul(1024 * 1024) as usize;
                if bytes.len() > max {
                    return jade_err(format!("The file is {} bytes, over the {} MB limit", bytes.len(), req.max_mb));
                }
                jade_ok(serde_json::json!({
                    "name": att.name,
                    "extension": att.extension,
                    "size": bytes.len(),
                    "base64": jade_b64_encode(&bytes),
                }).to_string())
            }
            Err(e) => jade_err(e),
        }
    }

    #[tool(description = "Events since the last call besides messages: reactions, edits and deletes, Community invites waiting for consent, and being removed from a Community. Returns and clears the buffer.")]
    async fn get_new_events(&self) -> Result<CallToolResult, McpError> {
        let events = crate::handler::jade_drain_events();
        jade_ok(serde_json::to_string(&events).unwrap_or_else(|_| "[]".to_string()))
    }

'''

HANDLER_TOP = r'''
// jade-vector additions: a buffer of non-message events, drained by the get_new_events tool.
static JADE_EVENTS: std::sync::OnceLock<std::sync::Mutex<Vec<serde_json::Value>>> = std::sync::OnceLock::new();

fn jade_events() -> &'static std::sync::Mutex<Vec<serde_json::Value>> {
    JADE_EVENTS.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

pub fn jade_push_event(v: serde_json::Value) {
    if let Ok(mut b) = jade_events().lock() {
        if b.len() >= 1000 {
            b.remove(0);
        }
        b.push(v);
    }
}

pub fn jade_drain_events() -> Vec<serde_json::Value> {
    match jade_events().lock() {
        Ok(mut b) => b.drain(..).collect(),
        Err(_) => Vec::new(),
    }
}
'''

HANDLER_METHODS = r'''
    // jade-vector additions
    fn on_reaction_received(&self, chat_id: &str, msg: &Message) {
        jade_push_event(serde_json::json!({ "type": "reaction", "chat_id": chat_id, "message_id": msg.id, "mine": msg.mine, "reactions": msg.reactions }));
    }

    fn on_message_deleted(&self, chat_id: &str, message_id: &str) {
        jade_push_event(serde_json::json!({ "type": "deleted", "chat_id": chat_id, "message_id": message_id }));
    }

    fn on_community_invite(&self, community_id: &str) {
        jade_push_event(serde_json::json!({ "type": "invite", "community_id": community_id }));
    }

    fn on_community_update(&self, chat_id: &str, target_id: &str, msg: &Message) {
        jade_push_event(serde_json::json!({ "type": "update", "chat_id": chat_id, "message_id": target_id, "mine": msg.mine, "edited": msg.edited, "content": msg.content, "reactions": msg.reactions }));
    }

    fn on_community_self_removed(&self, community_id: &str) {
        jade_push_event(serde_json::json!({ "type": "removed", "community_id": community_id }));
    }
'''

def insert_before(text, anchor, block, what):
    i = text.find(anchor)
    if i < 0:
        sys.exit(f'patch failed: could not find {what} ({anchor.strip()[:60]!r}). The vector-agent source changed; send this message to whoever maintains Jade Vault.')
    return text[:i] + block + text[i:]

def insert_after(text, anchor, block, what):
    i = text.find(anchor)
    if i < 0:
        sys.exit(f'patch failed: could not find {what} ({anchor.strip()[:60]!r}).')
    i += len(anchor)
    return text[:i] + block + text[i:]

def main():
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
    tools, handler = root / 'src' / 'tools.rs', root / 'src' / 'handler.rs'
    if not tools.is_file() or not handler.is_file():
        sys.exit(f'{root} does not look like crates/vector-agent (src/tools.rs and src/handler.rs missing)')
    t, h = tools.read_text(), handler.read_text()
    if MARK in t and MARK in h:
        print('vector-agent is already patched for Jade.')
        return
    if MARK not in t:
        t = insert_before(t, '/// A Mini App session the agent joined', HELPERS, 'the Mini App session struct')
        t = insert_before(t, '    // === Mini Apps (WebXDC) ===', TOOLS, 'the Mini Apps tool section')
        tools.write_text(t)
    if MARK not in h:
        h = insert_after(h, 'use vector_core::{InboundEventHandler, Message};\n', HANDLER_TOP, 'the handler imports')
        h = insert_after(h, 'impl InboundEventHandler for AgentEventHandler {\n', HANDLER_METHODS, 'the agent event handler')
        handler.write_text(h)
    print('Patched vector-agent: send_message, react, send_typing, edit_message, delete_message, send_file_bytes, download_attachment, get_new_events.')

if __name__ == '__main__':
    main()
