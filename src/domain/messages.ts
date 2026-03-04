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

export type ApplyMoveRequest = {
    seq: number;
    fromRow: number;
    fromCol: number;
    toRow: number;
    toCol: number;
}

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

export type ApplyMoveResult = {
    accepted: boolean;
    errorCode?: "UNAUTHORIZED" | "ROOM_NOT_READY" | "INVALID_MOVE";
    message?: string;
    state: GameState;
};

export type ClientEvent =
    | { type: "join"; playerId: string; slot?: PlayerSlot }
    | { type: "apply_move"; payload: ApplyMoveRequest }
    | { type: "ping" };

export type ServerEvent =
    | {type: "room_state"; payload: GameState }
    | {type: "move_accepted"; payload: ApplyMoveResult}
    | {type: "move_rejected"; payload: ApplyMoveResult}
    | {type: "queued"}
    | {type: "match_found"; roomId: string ; opponentId: string}
    | {type: "pong"}
    |{type: "error"; message: string };
