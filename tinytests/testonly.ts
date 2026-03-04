import type {
    ServerEvent,
    ClientEvent,
    PlayerSlot
} from "../src/domain/messages"

const logEl = document.getElementById("log") as HTMLPreElement | null;
const ws = new WebSocket("ws://localhost:8787/room/test-room?playerId=test1&roomId=test-room");

let seq = 0;
let slot: PlayerSlot = "P1";

const append = (value: unknown): void => {
    if(!logEl) return;
    logEl.textContent += `${JSON.stringify(value)}\n`;
};

const send = (event: ClientEvent): void => {
    ws.send(JSON.stringify(event));
};

function handleServerEvent(event: ServerEvent) {
    switch (event.type) {
        case "welcome":
            seq = event.seq;
            slot = event.player;
            append({local: "welcome", seq, slot});
            return;
        case "state":
            seq = event.seq;
            append({local: "state", seq, turn: event.state.turn});
            return;
        case "error":
            append({local: "error", code: event.code, message: event.message});
            return;
        case "pong":
        case "queued":
        case "match_found":
            append(event);
            return;
    }
}

ws.addEventListener("message", (e) => {const message = JSON.parse(String(e.data)) as ServerEvent
handleServerEvent(message)
;})

function join(): void {
    send({type: "join", playerId: "test1", slot})
}

function move(): void {
    send({type: "move",
    seq,
    move: {fromRow: 1, fromCol: 4, toRow: 3, toCol: 4}});

}

//Expose for HTML onclick
(window as typeof window & {join: () => void; move: () => void}).join = join;
(window as typeof window & {join: () => void; move: () => void}).move = move;
