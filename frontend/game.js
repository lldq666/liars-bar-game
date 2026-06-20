// 游戏状态
const GameState = {
    serverUrl: localStorage.getItem('serverUrl') || 'http://localhost:5000',
    gameId: null,
    playerId: null,
    hand: [],
    selectedCards: [],
    waitingRoomInterval: null,  // 等待房间的定时器
    gameRoomInterval: null,      // 游戏房间的定时器
    previousGameStatus: null,      // 之前的游戏状态（用于检测变化）
    isReady: false,                // 当前玩家是否已准备
    previousPlayerCount: 0,        // 之前的玩家数量
    previousRound: 0               // 之前的轮次（用于检测新一轮开始）
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    loadServerConfig();
    showPanel('server-config');
});

// 服务器配置管理
function loadServerConfig() {
    const savedUrl = localStorage.getItem('serverUrl');
    if (savedUrl) {
        document.getElementById('server-url').value = savedUrl;
        GameState.serverUrl = savedUrl;
    }
}

function saveServerConfig() {
    const url = document.getElementById('server-url').value.trim();
    if (!url) {
        alert('请输入服务器地址');
        return;
    }
    
    GameState.serverUrl = url;
    localStorage.setItem('serverUrl', url);
    updateConnectionStatus('配置已保存', 'success');
}

function setServer(url) {
    document.getElementById('server-url').value = url;
    saveServerConfig();
}

async function testConnection() {
    try {
        updateConnectionStatus('正在测试连接...', 'info');
        const url = `${GameState.serverUrl}/api/config`;
        console.log('正在连接:', url);
        
        const response = await fetch(url);
        console.log('响应状态:', response.status, response.statusText);
        
        // 先获取响应文本
        const responseText = await response.text();
        console.log('响应内容:', responseText.substring(0, 200));
        
        // 尝试解析JSON
        let data;
        try {
            data = JSON.parse(responseText);
        } catch (parseError) {
            // 如果不是JSON，显示实际内容
            updateConnectionStatus(`连接失败: 服务器返回了非JSON数据 (${response.status})`, 'error');
            console.error('服务器返回的不是JSON:', responseText);
            return;
        }
        
        if (data.success !== false) {
            updateConnectionStatus(`连接成功! 服务器: ${data.server_name} v${data.version}`, 'success');
            setTimeout(() => showPanel('lobby'), 1000);
        } else {
            updateConnectionStatus('连接失败: 服务器返回错误', 'error');
        }
    } catch (error) {
        updateConnectionStatus(`连接失败: ${error.message}`, 'error');
        console.error('连接错误:', error);
    }
}

function updateConnectionStatus(message, type) {
    const statusEl = document.getElementById('connection-status');
    statusEl.textContent = message;
    statusEl.className = type;
    statusEl.style.cssText = `
        padding: 10px;
        margin-top: 10px;
        border-radius: 5px;
        ${type === 'success' ? 'background: #d4edda; color: #155724;' : ''}
        ${type === 'error' ? 'background: #f8d7da; color: #721c24;' : ''}
        ${type === 'info' ? 'background: #d1ecf1; color: #0c5460;' : ''}
    `;
}

// 面板管理
function showPanel(panelId) {
    const panels = ['server-config', 'lobby', 'waiting-room', 'game-room'];
    panels.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    
    const targetEl = document.getElementById(panelId);
    if (targetEl) targetEl.classList.remove('hidden');
}

// 游戏大厅功能
function showCreateGame() {
    document.getElementById('create-game-form').classList.remove('hidden');
    document.getElementById('join-game-form').classList.add('hidden');
}

function hideCreateGame() {
    document.getElementById('create-game-form').classList.add('hidden');
}

function showJoinGame() {
    document.getElementById('join-game-form').classList.remove('hidden');
    document.getElementById('create-game-form').classList.add('hidden');
}

function hideJoinGame() {
    document.getElementById('join-game-form').classList.add('hidden');
}

async function createGame() {
    const gameId = document.getElementById('new-game-id').value.trim() || 
                   `game_${Date.now()}`;
    const maxPlayers = parseInt(document.getElementById('max-players').value);
    
    // 提示用户输入玩家ID（创建者）
    let playerId = GameState.playerId;
    if (!playerId) {
        playerId = prompt('请输入你的玩家ID（作为创建者）:', `player_${Date.now()}`);
        if (!playerId) {
            alert('创建游戏已取消');
            return;
        }
        GameState.playerId = playerId;
    }
    
    try {
        const response = await fetch(`${GameState.serverUrl}/api/game/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                game_id: gameId, 
                max_players: maxPlayers,
                player_id: playerId  // 发送创建者ID
            })
        });
        
        const data = await response.json();
        if (data.success) {
            GameState.gameId = gameId;
            addLog(`游戏创建成功: ${gameId}`);
            addLog(`你已作为 ${playerId} 自动加入游戏`);
            showWaitingRoom();
        } else {
            alert(data.message);
        }
    } catch (error) {
        alert(`创建游戏失败: ${error.message}`);
    }
}

async function joinGame() {
    const gameId = document.getElementById('join-game-id').value.trim();
    const playerId = document.getElementById('player-id').value.trim();
    
    if (!gameId || !playerId) {
        alert('请填写游戏ID和玩家ID');
        return;
    }
    
    try {
        const response = await fetch(`${GameState.serverUrl}/api/game/${gameId}/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: playerId })
        });
        
        const data = await response.json();
        if (data.success) {
            GameState.gameId = gameId;
            GameState.playerId = playerId;
            addLog(`加入游戏成功: ${gameId} 作为 ${playerId}`);
            showWaitingRoom();
        } else {
            alert(data.message);
        }
    } catch (error) {
        alert(`加入游戏失败: ${error.message}`);
    }
}

function showWaitingRoom() {
    showPanel('waiting-room');
    document.getElementById('current-game-id').textContent = GameState.gameId;
    GameState.isReady = false;
    updatePlayersList();
    
    // 获取当前游戏状态
    fetch(`${GameState.serverUrl}/api/game/${GameState.gameId}/state`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                GameState.previousGameStatus = data.game_state.status;
                GameState.previousPlayerCount = data.game_state.players.length;
            }
        })
        .catch(err => console.error('获取初始状态失败:', err));
    
    startWaitingRoomPolling();
}

// 启动等待房间的轮询
function startWaitingRoomPolling() {
    // 清除可能存在的旧定时器
    stopWaitingRoomPolling();
    
    // 重置游戏状态跟踪
    GameState.previousGameStatus = null;
    
    // 每2秒更新一次玩家列表和游戏状态
    GameState.waitingRoomInterval = setInterval(() => {
        updatePlayersList();
        checkGameStarted();
    }, 2000);
}

// 检测游戏是否已经开始
async function checkGameStarted() {
    try {
        const response = await fetch(`${GameState.serverUrl}/api/game/${GameState.gameId}/state`);
        const data = await response.json();
        
        if (data.success) {
            const currentStatus = data.game_state.status;
            
            // 检测到游戏状态从 waiting 变为 playing
            if (GameState.previousGameStatus === 'waiting' && currentStatus === 'playing') {
                addLog('游戏已经开始！正在进入游戏...', 'success');
                stopWaitingRoomPolling();
                showGameRoom();
            }
            
            // 更新状态跟踪
            GameState.previousGameStatus = currentStatus;
        }
    } catch (error) {
        console.error('检测游戏状态失败:', error);
    }
}

// 停止等待房间的轮询
function stopWaitingRoomPolling() {
    if (GameState.waitingRoomInterval) {
        clearInterval(GameState.waitingRoomInterval);
        GameState.waitingRoomInterval = null;
    }
}

async function updatePlayersList() {
    try {
        const response = await fetch(`${GameState.serverUrl}/api/game/${GameState.gameId}/state`);
        const data = await response.json();
        
        if (data.success) {
            const playersListEl = document.getElementById('players-list');
            playersListEl.innerHTML = '<h3>玩家列表:</h3>';
            
            const readyPlayers = data.game_state.ready_players || [];
            
            data.game_state.players.forEach(player => {
                const playerEl = document.createElement('div');
                playerEl.className = 'player-item';
                const isReady = readyPlayers.includes(player);
                const readyMark = isReady ? ' ✅' : ' ⏳';
                playerEl.innerHTML = `
                    <span>${player}${readyMark}</span>
                    <span>筹码: ${data.game_state.player_chips[player] || 0}</span>
                `;
                playersListEl.appendChild(playerEl);
            });
            
            // 更新准备按钮状态
            updateReadyButton(readyPlayers);
        }
    } catch (error) {
        console.error('更新玩家列表失败:', error);
    }
}

function updateReadyButton(readyPlayers) {
    const readyBtn = document.getElementById('ready-btn');
    if (!readyBtn) return;
    
    if (GameState.isReady) {
        readyBtn.textContent = '取消准备';
        readyBtn.className = 'btn-secondary';
    } else {
        readyBtn.textContent = '准备';
        readyBtn.className = 'btn-primary';
    }
}

async function toggleReady() {
    const newReadyState = !GameState.isReady;
    
    try {
        const response = await fetch(`${GameState.serverUrl}/api/game/${GameState.gameId}/ready`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                player_id: GameState.playerId,
                ready: newReadyState
            })
        });
        
        const data = await response.json();
        if (data.success) {
            GameState.isReady = newReadyState;
            addLog(data.message);
            
            if (data.all_ready) {
                addLog('所有玩家已准备，游戏开始!', 'success');
                // 停止等待房间的轮询
                stopWaitingRoomPolling();
                showGameRoom();
            }
            
            updatePlayersList();
        } else {
            alert(data.message);
        }
    } catch (error) {
        alert(`操作失败: ${error.message}`);
    }
}

async function leaveGame() {
    if (!GameState.gameId || !GameState.playerId) {
        // 如果还没有加入游戏，直接返回大厅
        GameState.gameId = null;
        GameState.playerId = null;
        GameState.isReady = false;
        showPanel('lobby');
        return;
    }
    
    try {
        // 调用后端API离开游戏
        const response = await fetch(`${GameState.serverUrl}/api/game/${GameState.gameId}/leave`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ player_id: GameState.playerId })
        });
        
        const data = await response.json();
        
        // 停止所有定时器
        stopWaitingRoomPolling();
        stopGameRoomPolling();
        
        // 重置状态
        const wasInWaitingRoom = GameState.previousGameStatus === 'waiting';
        GameState.gameId = null;
        GameState.playerId = null;
        GameState.isReady = false;
        GameState.previousGameStatus = null;
        GameState.previousRound = 0;
        
        // 显示消息
        if (data.success) {
            addLog(data.message, 'info');
            if (data.room_released) {
                addLog('房间已自动释放', 'success');
            }
        }
        
        // 返回大厅
        showPanel('lobby');
        
    } catch (error) {
        console.error('离开游戏失败:', error);
        // 即使API调用失败，也强制返回大厅
        GameState.gameId = null;
        GameState.playerId = null;
        GameState.isReady = false;
        stopWaitingRoomPolling();
        stopGameRoomPolling();
        showPanel('lobby');
    }
}

// 游戏房间功能
function showGameRoom() {
    showPanel('game-room');
    updateGameState();
    loadHand();
    startGameRoomPolling();
}

// 启动游戏房间的轮询
function startGameRoomPolling() {
    // 清除可能存在的旧定时器
    stopGameRoomPolling();
    
    // 每2秒更新一次游戏状态
    GameState.gameRoomInterval = setInterval(() => {
        if (GameState.gameId && GameState.playerId) {
            updateGameState();
        }
    }, 2000);
}

// 停止游戏房间的轮询
function stopGameRoomPolling() {
    if (GameState.gameRoomInterval) {
        clearInterval(GameState.gameRoomInterval);
        GameState.gameRoomInterval = null;
    }
}

async function updateGameState() {
    try {
        const response = await fetch(`${GameState.serverUrl}/api/game/${GameState.gameId}/state`);
        const data = await response.json();
        
        if (data.success) {
            const state = data.game_state;
            
            // 检查游戏是否结束
            if (state.status === 'finished' && GameState.previousGameStatus !== 'finished') {
                showGameOver(state);
                return;
            }
            
            // 更新游戏信息
            const newRound = state.round || 1;
            document.getElementById('round').textContent = newRound;
            document.getElementById('pot-count').textContent = state.pot_count || 0;
            
            // 检测新一轮开始（当有玩家手牌出完时）
            if (GameState.previousRound > 0 && newRound !== GameState.previousRound) {
                addLog(`新一轮开始！第${newRound}轮`, 'success');
                // 重新加载手牌（所有玩家的牌都被重新发牌了）
                loadHand();
            }
            GameState.previousRound = newRound;
            
            // 更新当前回合玩家
            const currentTurnEl = document.getElementById('current-turn');
            if (state.current_player) {
                currentTurnEl.textContent = `当前回合: ${state.current_player}`;
                currentTurnEl.style.cssText = 'font-weight: bold; color: #667eea;';
            }
            
            // 更新玩家信息
            updatePlayersInfo(state);
            
            // 更新上次出牌信息
            updateLastPlay(state);
            
            // 检查是否是自己的回合
            const isMyTurn = state.current_player === GameState.playerId;
            
            // 调试信息
            console.log('=== 回合检测调试 ===');
            console.log('current_player:', state.current_player);
            console.log('my playerId:', GameState.playerId);
            console.log('isMyTurn:', isMyTurn);
            console.log('last_claim:', state.last_claim);
            
            // 如果当前玩家不是自己，完全隐藏所有操作
            if (!isMyTurn) {
                document.getElementById('play-actions').classList.add('hidden');
                document.getElementById('last-play').classList.add('hidden');
                // 隐藏质疑按钮（如果在 play-actions 外面）
                const challengeBtn = document.getElementById('challenge-btn');
                if (challengeBtn) {
                    challengeBtn.classList.add('hidden');
                    console.log('隐藏质疑按钮 - 不是我的回合');
                }
            } else {
                // 是自己的回合
                document.getElementById('play-actions').classList.remove('hidden');
                
                // 只有当有上家出牌记录时，才显示质疑相关的内容
                if (state.last_claim && state.last_claim.player !== GameState.playerId) {
                    document.getElementById('last-play').classList.remove('hidden');
                    // 显示质疑按钮
                    const challengeBtn = document.getElementById('challenge-btn');
                    if (challengeBtn) {
                        challengeBtn.classList.remove('hidden');
                        console.log('显示质疑按钮 - 有上家出牌记录');
                    }
                } else {
                    // 如果是自己刚出的牌，或者没有上家出牌记录（游戏刚开始）
                    document.getElementById('last-play').classList.add('hidden');
                    const challengeBtn = document.getElementById('challenge-btn');
                    if (challengeBtn) {
                        challengeBtn.classList.add('hidden');
                        console.log('隐藏质疑按钮 - 没有上家出牌记录或自己刚出牌');
                    }
                }
            }
        }
    } catch (error) {
        console.error('更新游戏状态失败:', error);
    }
}

function updatePlayersInfo(state) {
    const playersInfoEl = document.getElementById('players-info');
    playersInfoEl.innerHTML = '';
    
    state.players.forEach(player => {
        const playerCard = document.createElement('div');
        playerCard.className = 'player-card';
        
        if (player === state.current_player) {
            playerCard.classList.add('current-turn');
        }
        
        const chipCount = state.player_chips[player] || 0;
        const handCount = state.player_hands_count[player] || 0;
        
        playerCard.innerHTML = `
            <div class="player-name">${player} ${player === GameState.playerId ? '(你)' : ''}</div>
            <div class="chip-count">🎲 ${chipCount}</div>
            <div class="hand-count">手牌: ${handCount}张</div>
        `;
        
        playersInfoEl.appendChild(playerCard);
    });
}

function updateLastPlay(state) {
    const lastPlayEl = document.getElementById('last-play');
    const lastPlayInfoEl = document.getElementById('last-play-info');
    
    if (state.last_claim) {
        lastPlayInfoEl.innerHTML = `
            <strong>${state.last_claim.player}</strong> 
            出了 <strong>${state.last_claim.count}</strong> 张牌，
            声称是 <strong>${state.last_claim.card_type}</strong>
        `;
    } else {
        // 如果没有 last_claim，清空内容（但不控制显示/隐藏）
        lastPlayInfoEl.innerHTML = '';
    }
}

// 手牌管理
async function loadHand() {
    try {
        const response = await fetch(
            `${GameState.serverUrl}/api/game/${GameState.gameId}/hand/${GameState.playerId}`
        );
        const data = await response.json();
        
        if (data.success) {
            GameState.hand = data.hand;
            renderHand();
        }
    } catch (error) {
        console.error('加载手牌失败:', error);
    }
}

function renderHand() {
    const cardsContainer = document.getElementById('cards-container');
    const handCountEl = document.getElementById('hand-count');
    
    cardsContainer.innerHTML = '';
    handCountEl.textContent = GameState.hand.length;
    
    GameState.hand.forEach((card, index) => {
        const cardEl = document.createElement('div');
        cardEl.className = 'card';
        cardEl.textContent = card;
        cardEl.onclick = () => toggleCard(index);
        
        if (GameState.selectedCards.includes(index)) {
            cardEl.classList.add('selected');
        }
        
        cardsContainer.appendChild(cardEl);
    });
}

function toggleCard(index) {
    const idx = GameState.selectedCards.indexOf(index);
    if (idx === -1) {
        GameState.selectedCards.push(index);
    } else {
        GameState.selectedCards.splice(idx, 1);
    }
    renderHand();
    updateSelectedCardsDisplay();
}

function updateSelectedCardsDisplay() {
    const selectedCardsEl = document.getElementById('selected-cards');
    selectedCardsEl.innerHTML = '<strong>已选择:</strong> ';
    
    GameState.selectedCards.forEach(index => {
        const badge = document.createElement('span');
        badge.style.cssText = 'display: inline-block; padding: 5px 10px; background: #667eea; color: white; border-radius: 5px; margin: 2px;';
        badge.textContent = GameState.hand[index];
        selectedCardsEl.appendChild(badge);
    });
}

// 出牌功能
async function playCards() {
    if (GameState.selectedCards.length === 0) {
        alert('请选择要出的牌');
        return;
    }
    
    const claimedType = document.getElementById('claim-type').value;
    
    try {
        const response = await fetch(
            `${GameState.serverUrl}/api/game/${GameState.gameId}/play`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    player_id: GameState.playerId,
                    card_indices: [...GameState.selectedCards],
                    claimed_type: claimedType
                })
            }
        );
        
        const data = await response.json();
        if (data.success) {
            addLog(data.message, 'success');
            GameState.selectedCards = [];
            document.getElementById('play-actions').classList.add('hidden');
            updateGameState();
            loadHand();
        } else {
            alert(data.message);
        }
    } catch (error) {
        alert(`出牌失败: ${error.message}`);
    }
}

function cancelPlay() {
    GameState.selectedCards = [];
    document.getElementById('play-actions').classList.add('hidden');
    renderHand();
}

// 质疑功能
async function challenge() {
    if (!confirm('确定要质疑吗?')) {
        return;
    }
    
    try {
        const response = await fetch(
            `${GameState.serverUrl}/api/game/${GameState.gameId}/challenge`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ player_id: GameState.playerId })
            }
        );
        
        const data = await response.json();
        if (data.success) {
            const result = data.result;
            let logMessage = result.message + '\n';
            logMessage += `实际牌: ${result.actual_cards.join(', ')}\n`;
            logMessage += `声称类型: ${result.claimed_type}`;
            
            addLog(logMessage, result.is_lying ? 'danger' : 'warning');
            
            document.getElementById('last-play').classList.add('hidden');
            updateGameState();
            loadHand();
        } else {
            alert(data.message);
        }
    } catch (error) {
        alert(`质疑失败: ${error.message}`);
    }
}

// 游戏日志
function addLog(message, type = 'info') {
    const logMessagesEl = document.getElementById('log-messages');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logMessagesEl.appendChild(logEntry);
    logMessagesEl.scrollTop = logMessagesEl.scrollHeight;
}

// 显示游戏结束界面
function showGameOver(state) {
    GameState.previousGameStatus = 'finished';
    stopGameRoomPolling();
    
    const isWinner = state.winner === GameState.playerId;
    const message = isWinner ? '🎉 恭喜你获胜！' : `游戏结束！胜利者: ${state.winner}`;
    
    // 创建游戏结束弹窗
    const overlay = document.createElement('div');
    overlay.id = 'game-over-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    `;
    
    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: white;
        padding: 40px;
        border-radius: 15px;
        text-align: center;
        max-width: 500px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
    `;
    
    let playersResultHtml = '';
    for (const [player, chips] of Object.entries(state.player_chips)) {
        playersResultHtml += `<p style="margin: 5px 0;"><strong>${player}</strong>: ${chips} 筹码</p>`;
    }
    
    dialog.innerHTML = `
        <h1 style="color: ${isWinner ? '#4CAF50' : '#667eea'}; font-size: 48px; margin-bottom: 20px;">
            ${isWinner ? '🎉' : '😢'}
        </h1>
        <h2 style="margin-bottom: 20px;">${message}</h2>
        <div style="margin: 20px 0;">
            <h3>最终筹码:</h3>
            ${playersResultHtml}
        </div>
        <button onclick="releaseGameRoom()" style="
            padding: 15px 30px;
            font-size: 18px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
        ">结束游戏并释放房间</button>
    `;
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
}

// 释放游戏房间
async function releaseGameRoom() {
    if (!confirm('确定要结束游戏并释放房间吗？')) {
        return;
    }
    
    try {
        const response = await fetch(`${GameState.serverUrl}/api/game/${GameState.gameId}/release`, {
            method: 'POST'
        });
        
        const data = await response.json();
        if (data.success) {
            addLog(data.message, 'success');
            
            // 移除游戏结束弹窗
            const overlay = document.getElementById('game-over-overlay');
            if (overlay) overlay.remove();
            
            // 停止所有定时器
            stopWaitingRoomPolling();
            stopGameRoomPolling();
            
            // 重置状态
            GameState.gameId = null;
            GameState.playerId = null;
            GameState.isReady = false;
            GameState.previousGameStatus = null;
            
            // 返回大厅
            showPanel('lobby');
        } else {
            alert(data.message);
        }
    } catch (error) {
        alert(`释放房间失败: ${error.message}`);
    }
}

// 注: 原有的定时更新已移至 startGameRoomPolling() 函数中统一管理
