# Jade Link — protocol

Jade Link is a messenger plus a shared task board between the user (you@jade.vault) and Jade (jade@jade.vault).
Everything is a webxdc update. The app rebuilds its state by replaying all updates in order.

## Payloads

Message:
  {"type": "msg", "id": "<unique>", "text": "markdown-lite text", "cards": [ ...optional card ops... ]}

Card operations (as their own update, or inside a message's "cards" array):
  {"type": "card", "op": "add",  "id": "<unique>", "title": "Water the plants", "col": "todo"}
  {"type": "card", "op": "move", "id": "<card id>", "col": "todo" | "doing" | "done"}
  {"type": "card", "op": "edit", "id": "<card id>", "title": "new title"}
  {"type": "card", "op": "del",  "id": "<card id>"}
Inside a message's "cards" array the "type" field may be left out. "id" is optional on add.

The sender is taken from the update itself, so Jade never needs to set "from".

## For Jade

- The user's messages reach you with notify {"jade@jade.vault": text}. Answer with
  apps action=send app="Jade Link" payload={"type":"msg","text":"..."} — one short, warm message.
- To act on the board, add "cards" to your message, e.g.
  {"type":"msg","text":"Added it.","cards":[{"op":"add","title":"Call mom","col":"todo"}]}
- Card ids are shown by apps action=read (payload.id of each add). Move or finish cards by id.
- Text supports **bold**, *italic*, `code` and line breaks. Keep messages short: this is a phone chat.
