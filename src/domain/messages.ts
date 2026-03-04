export type PlayerSlot = "P1" | "P2";

export type Move = {
    fromRow: number;
    fromCol: number;
    toRow: number;
    toCol: number;
}

export type PieceSnapshot = {
    row: number;
    col: number;
    type: "pawn" | "knight" | "rook" | "bishop" | "queen" | "king" | "custom" | "none";
    color: "white" | "black" | "none";
    customTypeId: string;
}

export type MoveMessage = {
    type: "move";
    seq?: number;
    move: Move;
};

export type GameState = {
    roomId: string;
    seq: number;
    turn: PlayerSlot;
    inCheck: boolean;
    checkmate: boolean;
    stalemate: boolean;
    finished: boolean;
    winnerPlayerId: PlayerSlot | "";
    pieces: PieceSnapshot[];
    legalMoves: Move[];
};

export type ProtocolErrorCode =
    | "INVALID_MOVE"
    | "UNAUTHORIZED"
    | "ROOM_FULL"
    | "ROOM_NOT_FOUND"
    | "ROOM_NOT_READY"
    | "BAD_REQUEST"
    | "INTERNAL_ERROR"
    | "UNSUPPORTED_MESSAGE";

export type FinishedPayload = {
    outcome: "Winner" | "Draw";
    winner?: PlayerSlot;
};

export type ClientEvent =
    | { type: "join"; playerId: string; slot?: PlayerSlot }
    | MoveMessage
    | { type: "ping" };

export type ServerEvent =
    | { type: "welcome"; room_id: string; player: PlayerSlot; seq: number; state: GameState }
    | { type: "state"; seq: number; state: GameState; last_move_by: PlayerSlot; finished?: FinishedPayload }
    | { type: "queued" }
    | { type: "match_found"; roomId: string; opponentId: string }
    | { type: "pong" }
    | { type: "error"; code: ProtocolErrorCode; message: string };
