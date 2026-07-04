// ============================================
//  五子棋局域网联机 — 服务器
//  启动: node server.js
//  主机访问: http://localhost:3000
//  客机访问: http://<主机IP>:3000
// ============================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 托管前端页面
app.use(express.static('public'));

// ========== 游戏配置 ==========
const BOARD_SIZE = 15;
const WIN_COUNT = 5;

// ========== 游戏状态 ==========
let board = [];              // board[row][col]: 0=空, 1=黑, 2=白
let players = {};            // { socketId: { color: 1|2, name: '黑方'|'白方' } }
let currentTurn = 1;         // 1=黑方回合, 2=白方回合
let gameOver = false;
let winner = 0;
let playerCount = 0;

function initBoard() {
    board = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
        board[row] = new Array(BOARD_SIZE).fill(0);
    }
    currentTurn = 1;
    gameOver = false;
    winner = 0;
}

// 初始化棋盘
initBoard();

// ========== 胜负判定 ==========
function checkWin(row, col, player) {
    const directions = [
        [0, 1],   // → 水平
        [1, 0],   // ↓ 垂直
        [1, 1],   // ↘ 对角线
        [1, -1],  // ↙ 反对角线
    ];

    for (const [dr, dc] of directions) {
        let count = 1;

        // 正方向延伸
        for (let i = 1; i < WIN_COUNT; i++) {
            const r = row + dr * i;
            const c = col + dc * i;
            if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break;
            if (board[r][c] !== player) break;
            count++;
        }

        // 反方向延伸
        for (let i = 1; i < WIN_COUNT; i++) {
            const r = row - dr * i;
            const c = col - dc * i;
            if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) break;
            if (board[r][c] !== player) break;
            count++;
        }

        if (count >= WIN_COUNT) return true;
    }
    return false;
}

// ========== 获取局域网 IP ==========
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // 筛选 IPv4、非内部地址
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// ========== Socket.io 通信 ==========
io.on('connection', (socket) => {
    console.log(`[连接] 新玩家接入: ${socket.id}`);

    // --- 加入游戏 ---
    socket.on('join', () => {
        // 去重：同一个 socket 已经加入过，直接返回当前状态
        if (players[socket.id]) {
            const p = players[socket.id];
            socket.emit('roomStatus', {
                status: playerCount >= 2 ? 'ready' : 'waiting',
                yourColor: p.color,
                yourName: p.name,
                message: playerCount >= 2 ? '对手已就位，游戏开始！' : '等待对手加入...',
                board: board,
                currentTurn: currentTurn,
                gameOver: gameOver,
                winner: winner
            });
            return;
        }
        if (playerCount >= 2) {
            // 房间已满
            socket.emit('roomStatus', {
                status: 'full',
                message: '房间已满，请稍后再试'
            });
            console.log(`[拒绝] ${socket.id} — 房间已满`);
            return;
        }

        playerCount++;
        const color = playerCount === 1 ? 1 : 2;  // 先连=黑(1)  后连=白(2)
        players[socket.id] = {
            color: color,
            name: color === 1 ? '黑方' : '白方'
        };

        console.log(`[加入] ${socket.id} → ${players[socket.id].name} (当前${playerCount}/2人)`);

        // 告知该玩家他的颜色和当前状态
        socket.emit('roomStatus', {
            status: playerCount === 2 ? 'ready' : 'waiting',
            yourColor: color,
            yourName: color === 1 ? '黑方' : '白方',
            message: playerCount === 2 ? '对手已就位，游戏开始！' : '等待对手加入...',
            board: board,
            currentTurn: currentTurn,
            gameOver: gameOver,
            winner: winner
        });

        // 如果两人都到了，通知双方开始
        if (playerCount === 2) {
            io.emit('roomStatus', {
                status: 'ready',
                message: '双方就位，游戏开始！黑方先手 ⚫',
                board: board,
                currentTurn: currentTurn,
                gameOver: false,
                winner: 0
            });
        }
    });

    // --- 落子 ---
    socket.on('move', (data) => {
        const player = players[socket.id];
        if (!player) return;

        const { row, col } = data;

        // 校验：游戏已结束
        if (gameOver) {
            socket.emit('moveError', { message: '游戏已结束' });
            return;
        }

        // 校验：还没凑齐两人
        if (playerCount < 2) {
            socket.emit('moveError', { message: '等待对手加入' });
            return;
        }

        // 校验：轮到你了没
        if (player.color !== currentTurn) {
            socket.emit('moveError', { message: '还没轮到你' });
            return;
        }

        // 校验：坐标合法
        if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
            socket.emit('moveError', { message: '落子位置不合法' });
            return;
        }

        // 校验：位置为空
        if (board[row][col] !== 0) {
            socket.emit('moveError', { message: '这里已经有棋子了' });
            return;
        }

        // 落子
        board[row][col] = player.color;
        console.log(`[落子] ${player.name} → (${row}, ${col})`);

        // 广播落子给所有人
        io.emit('moveConfirmed', {
            row: row,
            col: col,
            player: player.color
        });

        // 检查胜负
        if (checkWin(row, col, player.color)) {
            gameOver = true;
            winner = player.color;
            io.emit('gameOver', {
                winner: winner,
                winnerName: player.name
            });
            console.log(`[结束] ${player.name} 获胜！`);
            return;
        }

        // 检查平局（棋盘满）
        let hasEmpty = false;
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                if (board[r][c] === 0) {
                    hasEmpty = true;
                    break;
                }
            }
            if (hasEmpty) break;
        }
        if (!hasEmpty) {
            gameOver = true;
            io.emit('gameOver', { winner: 0, winnerName: '平局' });
            console.log('[结束] 平局！');
            return;
        }

        // 换手
        currentTurn = currentTurn === 1 ? 2 : 1;
    });

    // --- 重新开始 ---
    socket.on('reset', () => {
        initBoard();

        // 交换黑白（让先手轮流）
        const oldPlayers = { ...players };
        players = {};
        for (const [id, p] of Object.entries(oldPlayers)) {
            const newColor = p.color === 1 ? 2 : 1;
            players[id] = {
                color: newColor,
                name: newColor === 1 ? '黑方' : '白方'
            };
        }
        currentTurn = 1;

        console.log('[重置] 游戏重新开始，黑白交换');

        // 通知每个玩家自己的新颜色
        for (const [id, p] of Object.entries(players)) {
            io.to(id).emit('roomStatus', {
                status: 'ready',
                yourColor: p.color,
                yourName: p.name,
                message: '游戏重新开始！',
                board: board,
                currentTurn: currentTurn,
                gameOver: false,
                winner: 0
            });
        }

        io.emit('resetConfirmed', {
            board: board,
            currentTurn: currentTurn,
            message: '游戏重新开始，黑白交换，黑方先手 ⚫'
        });
    });

    // --- 断开连接 ---
    socket.on('disconnect', () => {
        console.log(`[断开] ${socket.id} (${players[socket.id]?.name || '观战者'}) 离开`);

        if (players[socket.id]) {
            playerCount--;
            delete players[socket.id];

            // 重置游戏状态
            initBoard();
            currentTurn = 1;

            // 把剩下的玩家重置（如果还有人）
            const remaining = Object.keys(players);
            if (remaining.length === 1) {
                players[remaining[0]] = { color: 1, name: '黑方' };
                io.to(remaining[0]).emit('playerLeft', {
                    message: '对手离开了，等待新对手加入...'
                });
                io.to(remaining[0]).emit('roomStatus', {
                    status: 'waiting',
                    yourColor: 1,
                    yourName: '黑方',
                    message: '对手离开，你自动成为黑方，等待新对手...',
                    board: board,
                    currentTurn: 1,
                    gameOver: false,
                    winner: 0
                });
            } else {
                // 没人了，重置
                playerCount = 0;
                players = {};
            }
        }
    });
});

// ========== 启动服务器 ==========
const PORT = 3456;
server.listen(PORT, '0.0.0.0', () => {
    const localIP = getLocalIP();
    console.log('');
    console.log('╔══════════════════════════════════════╗');
    console.log('║       🎮 五子棋 联机服务器已启动      ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║  主机访问: http://localhost:${PORT}      ║`);
    console.log(`║  客机访问: http://${localIP}:${PORT}     ║`);
    console.log('║                                      ║');
    console.log('║  把客机地址发给同一局域网的对手即可    ║');
    console.log('╚══════════════════════════════════════╝');
    console.log('');
});
