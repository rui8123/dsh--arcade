// 五子棋联机服务器（零依赖，Node 18+）
// 用法：node gomoku-server.mjs        默认端口 8765
//       PORT=9000 node gomoku-server.mjs
//
// 它同时做两件事：
//   1. 把 gomoku.html 发给手机（同一目录下）
//   2. 用 SSE + POST 同步两个玩家的棋盘状态（房间号 4 位）

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8765);
const SIZE = 15;
const rooms = new Map();

function newBoard() {
  return new Array(SIZE * SIZE).fill(0);
}

function createRoom() {
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
  const room = {
    code,
    board: newBoard(),
    turn: 1,
    winner: 0,
    line: [],
    last: -1,
    moves: 0,
    seats: [],            // [1] 或 [1,2]
    tokens: {},           // 座位 -> 重连凭证
    clients: new Set()    // SSE 响应对象
  };
  rooms.set(code, room);
  return room;
}

function makeToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function snapshot(room) {
  return {
    board: room.board,
    turn: room.turn,
    winner: room.winner,
    line: room.line,
    last: room.last,
    moves: room.moves,
    players: room.seats.length
  };
}

function broadcast(room) {
  const payload = "data: " + JSON.stringify(snapshot(room)) + "\n\n";
  for (const res of room.clients) {
    try { res.write(payload); } catch { room.clients.delete(res); }
  }
}

function checkWin(board, idx, player) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const r0 = Math.floor(idx / SIZE), c0 = idx % SIZE;
  for (const [dr, dc] of dirs) {
    const line = [idx];
    for (let s = 1; s < SIZE; s++) {
      const r = r0 + dr * s, c = c0 + dc * s;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || board[r * SIZE + c] !== player) break;
      line.push(r * SIZE + c);
    }
    for (let s = 1; s < SIZE; s++) {
      const r = r0 - dr * s, c = c0 - dc * s;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE || board[r * SIZE + c] !== player) break;
      line.push(r * SIZE + c);
    }
    if (line.length >= 5) {
      line.sort((a, b) => a - b);
      return { winner: player, line };
    }
  }
  return { winner: 0, line: [] };
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }

  // ---------- 静态页面 ----------
  if (req.method === "GET" && (p === "/" || p === "/index.html" || p === "/arcade.html" || p === "/gomoku.html")) {
    // 优先发「游戏厅」（坦克大战 + 五子棋），没有就退回单纯五子棋
    const arcade = path.join(__dirname, "arcade.html");
    const gomoku = path.join(__dirname, "gomoku.html");
    const file = fs.existsSync(arcade) ? arcade : gomoku;
    if (!fs.existsSync(file)) { return sendJson(res, 404, { error: "找不到页面文件，请把 arcade.html / gomoku.html 和服务器放同一目录" }); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return fs.createReadStream(file).pipe(res);
  }

  // ---------- 创建房间 ----------
  if (req.method === "POST" && p === "/api/create") {
    const room = createRoom();
    room.seats.push(1);
    room.tokens[1] = makeToken();
    return sendJson(res, 200, { room: room.code, seat: 1, token: room.tokens[1] });
  }

  // ---------- 加入房间 ----------
  if (req.method === "POST" && p === "/api/join") {
    const body = await readBody(req);
    const room = rooms.get(String(body.room || ""));
    if (!room) return sendJson(res, 404, { error: "房间不存在，检查房间号" });
    const token = String(body.token || "");
    if (room.seats.includes(2)) {
      // 只有拿着 2 号位凭证的人才能重连，其他人一律视为满房
      if (token && room.tokens[2] === token) return sendJson(res, 200, { seat: 2, token });
      return sendJson(res, 200, { error: "房间已满" });
    }
    room.seats.push(2);
    room.tokens[2] = makeToken();
    broadcast(room);
    return sendJson(res, 200, { seat: 2, token: room.tokens[2] });
  }

  // ---------- SSE 状态流 ----------
  if (req.method === "GET" && p === "/api/stream") {
    const room = rooms.get(url.searchParams.get("room") || "");
    if (!room) { res.writeHead(404); return res.end("no room"); }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    res.write("retry: 1500\n\n");
    res.write("data: " + JSON.stringify(snapshot(room)) + "\n\n");
    room.clients.add(res);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 20000);
    req.on("close", () => { clearInterval(ping); room.clients.delete(res); });
    return;
  }

  // ---------- 落子 ----------
  if (req.method === "POST" && p === "/api/move") {
    const body = await readBody(req);
    const room = rooms.get(String(body.room || ""));
    if (!room) return sendJson(res, 404, { error: "房间不存在" });
    const seat = Number(body.seat);
    const idx = Number(body.index);
    if (room.winner) return sendJson(res, 409, { error: "对局已结束" });
    if (room.seats.length < 2) return sendJson(res, 409, { error: "等待对手加入" });
    if (seat !== room.turn) return sendJson(res, 409, { error: "还没轮到你" });
    if (!Number.isInteger(idx) || idx < 0 || idx >= SIZE * SIZE) return sendJson(res, 400, { error: "坐标非法" });
    if (room.board[idx] !== 0) return sendJson(res, 409, { error: "这里已经有棋子了" });
    room.board[idx] = room.turn;
    room.last = idx;
    room.moves += 1;
    const res2 = checkWin(room.board, idx, room.turn);
    if (res2.winner) { room.winner = res2.winner; room.line = res2.line; }
    else room.turn = 3 - room.turn;
    broadcast(room);
    return sendJson(res, 200, { ok: true });
  }

  // ---------- 重开 ----------
  if (req.method === "POST" && p === "/api/restart") {
    const body = await readBody(req);
    const room = rooms.get(String(body.room || ""));
    if (!room) return sendJson(res, 404, { error: "房间不存在" });
    const seat = Number(body.seat);
    if (!room.seats.includes(seat)) return sendJson(res, 403, { error: "你不在这个房间" });
    room.board = newBoard();
    room.turn = 1; room.winner = 0; room.line = []; room.last = -1; room.moves = 0;
    broadcast(room);
    return sendJson(res, 200, { ok: true });
  }

  // ---------- 调试用 ----------
  if (req.method === "GET" && p === "/api/state") {
    const room = rooms.get(url.searchParams.get("room") || "");
    return room ? sendJson(res, 200, snapshot(room)) : sendJson(res, 404, { error: "房间不存在" });
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("五子棋服务器已启动");
  console.log("  本机:  http://127.0.0.1:" + PORT);
  for (const ip of lanAddresses()) console.log("  手机:  http://" + ip + ":" + PORT + "   (同一 WiFi)");
  console.log("  房间号由第一位玩家点「创建房间」生成");
});

// 清掉 6 小时没人的房间
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 && room.moves === 0) rooms.delete(code);
  }
}, 3600 * 1000).unref();
